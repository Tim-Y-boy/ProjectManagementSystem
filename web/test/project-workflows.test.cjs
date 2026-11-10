const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Vue = require('vue');
const { parse, compileScript } = require('@vue/compiler-sfc');
const { compile } = require('@vue/compiler-dom');
const ts = require('typescript');

function source(file) { return fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'); }
function setup(file, props, mocks) {
  const { descriptor } = parse(source(file));
  const script = compileScript(descriptor, { id: 'workflow-test' }).content;
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name === 'vue' ? Vue : mocks[name] || {}, console });
  return module.exports.default.setup(props, { expose() {}, emit() {} });
}
function menu(user, confirm) {
  const calls = [];
  const state = setup('components/ProjectTerminationMenu.vue', { project: { id: 7, status: 'active', ownerIds: [2] } }, {
    'vue-router': { useRouter: () => ({ push() {} }) },
    '@/stores/auth': { useAuthStore: () => ({ user, readOnly: false }) },
    '@/stores/refresh': { useRefreshStore: () => ({ markProjectChanged() {} }) },
    '@/utils/project-owner': { isOwnerOf: (p, id) => p.ownerIds.includes(id) },
    '@/api': { terminationsApi: { submit: async (...args) => calls.push(args) } },
    'element-plus': { ElMessage: { warning() {}, error() {}, success() {} }, ElMessageBox: { confirm } },
  });
  return { state, calls };
}

test('termination requires ownership, a reason, and explicit second confirmation', async () => {
  let confirmations = 0;
  const denied = menu({ id: 99 }, async () => { confirmations++; });
  denied.state.reason.value = 'reason';
  await denied.state.submit();
  assert.equal(confirmations, 0);
  assert.equal(denied.calls.length, 0);
  const allowed = menu({ id: 2 }, async (_message, _title, options) => {
    confirmations++;
    assert.equal(options.closeOnClickModal, false);
    assert.equal(options.closeOnPressEscape, false);
  });
  await allowed.state.submit();
  assert.equal(confirmations, 0, 'empty reason must not open confirmation');
  allowed.state.reason.value = '  project stopped  ';
  await allowed.state.submit();
  assert.equal(confirmations, 1);
  assert.equal(allowed.calls.length, 1);
  assert.equal(allowed.calls[0][0], 7);
  assert.equal(allowed.calls[0][1], 'project stopped');
});

test('administrator can request termination without project ownership', async () => {
  const admin = menu({ id: 99, roles: ['admin'] }, async () => {});
  admin.state.reason.value = '管理员申请终止';
  await admin.state.submit();
  assert.equal(admin.calls.length, 1);
});

test('cancelled confirmation preserves the reason and sends no request; repeated clicks do not duplicate submission', async () => {
  const cancelled = menu({ id: 2 }, async () => { throw 'cancel'; });
  cancelled.state.reason.value = 'reason';
  await cancelled.state.submit();
  assert.equal(cancelled.calls.length, 0);
  assert.equal(cancelled.state.reason.value, 'reason');
  assert.equal(cancelled.state.saving.value, false);
  let confirm;
  const pending = menu({ id: 2 }, () => new Promise(resolve => { confirm = resolve; }));
  pending.state.reason.value = 'reason';
  const first = pending.state.submit();
  await pending.state.submit();
  assert.equal(pending.calls.length, 0);
  confirm(); await first;
  assert.equal(pending.calls.length, 1);
});

test('compiled task title activates the same detail callback without toggling its parent; arrow only toggles', () => {
  const { descriptor } = parse(source('views/TaskRow.vue'));
  const tree = compile(descriptor.template.content).ast;
  function find(node, className) {
    if (node.type === 1 && node.props.some(p => p.name === 'class' && p.value?.content.split(' ').includes(className))) return node;
    for (const child of node.children || []) { const match = find(child, className); if (match) return match; }
    for (const branch of node.branches || []) { const match = find(branch, className); if (match) return match; }
  }
  let detail = 0, toggles = 0, stopped = 0;
  const task = { id: 4, title: 'task', children: [{}] };
  const context = { task, openDetail: t => { assert.equal(t, task); detail++; }, emit: (name, id) => { assert.equal(name, 'toggle'); assert.equal(id, 4); toggles++; }, isCollapsed: () => false };
  function render(className) {
    const node = find(tree, className); assert.ok(node);
    const code = compile(node.loc.source, { mode: 'function' }).code;
    return new Function('Vue', code)({ ...Vue, resolveComponent: name => name })(context, []);
  }
  const title = render('task-title-button');
  assert.equal(title.type, 'button'); assert.equal(title.props.type, 'button');
  title.props.onClick({ stopPropagation() { stopped++; } });
  assert.equal(detail, 1); assert.equal(toggles, 0); assert.equal(stopped, 1);
  render('fold-button').props.onClick({ stopPropagation() { stopped++; } });
  assert.equal(detail, 1); assert.equal(toggles, 1); assert.equal(stopped, 2);
});

test('termination request is only a dropdown action, and approval links retain the record on mobile', () => {
  const { descriptor } = parse(source('components/ProjectTerminationMenu.vue'));
  const tree = compile(descriptor.template.content).ast;
  const requestNodes = [];
  function visit(node, parents = []) {
    if (node.type === 1 && node.props.some(p => p.name === 'command' && p.value?.content === 'request')) requestNodes.push({ node, parents });
    for (const child of [...(node.children || []), ...(node.branches || [])]) visit(child, [...parents, node]);
  }
  visit(tree);
  assert.equal(requestNodes.length, 1);
  assert.equal(requestNodes[0].node.tag, 'el-dropdown-item');
  assert.ok(requestNodes[0].parents.some(p => p.tag === 'el-dropdown-menu'));
  const code = ts.transpileModule(source('utils/todo-inbox.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports });
  const rows = module.exports.buildInbox({ terminations: [{ id: 42, projectId: 7, projectName: 'Project', status: 'pending', canReview: true }, { id: 43, status: 'approved', canReview: false }, { id: 44, status: 'pending', canReview: false }] }, [], [], [], '2026-11-03');
  assert.equal(rows.length, 1, 'only actionable requests belong in approvals');
  assert.equal(rows[0].path, '/approvals?tab=termination&terminationId=42');
  assert.equal(rows[0].mobilePath, '/mobile/approve?tab=termination&terminationId=42');
  const router = source('router/index.ts');
  assert.match(router, /path: 'approve', name: 'm-approve', component: \(\) => import\('@\/views\/Approvals.vue'\)/);
});

test('copy sources include archived and terminated projects; new owner and department must be selected in business scope', async () => {
  const requests = [];
  const state = setup('components/ProjectCopyDialog.vue', { depts: [{ id: 3, businessSelectable: true }, { id: 8, businessSelectable: false }], users: [{ id: 2, businessSelectable: true }] }, {
    '@/api': { projectsApi: { list: async params => { assert.equal(params.status, 'all'); return [{ id: 9, name: 'Old', status: 'terminated', ownerIds: [55], deptId: 8, category: 'Category' }]; } }, copyProject: async (...args) => requests.push(args) },
    '@/stores/refresh': { useRefreshStore: () => ({ markProjectPlanChanged() {} }) },
    'element-plus': { ElMessage: { warning() {}, error() {}, success() {} } },
  });
  await state.open(); state.sourceId.value = 9; state.selectSource();
  const firstLabel = state.sourceLabel({ id: 9, name: 'Same project', status: 'terminated', startAt: '2026-10-01', endAt: '2026-10-31' });
  const secondLabel = state.sourceLabel({ id: 10, name: 'Same project', status: 'terminated', startAt: '2026-10-01', endAt: '2026-10-31' });
  assert.notEqual(firstLabel, secondLabel, 'same-name, same-status sources remain distinguishable');
  assert.ok(firstLabel.includes('#9')); assert.ok(firstLabel.includes('2026-10-01')); assert.ok(firstLabel.includes('2026-10-31'));
  assert.ok(state.sourceLabel({ id: 11, name: 'Unscheduled', createdAt: '2026-09-12T08:00:00Z' }).includes('2026-09-12'));
  assert.equal(state.form.value.deptId, null); assert.equal(state.form.value.ownerIds.length, 0);
  await state.save(); assert.equal(requests.length, 0);
  state.form.value.deptId = 8; state.form.value.ownerIds = [2];
  await state.save(); assert.equal(requests.length, 0, 'out-of-scope department rejected');
  state.form.value.deptId = 3; await state.save();
  assert.equal(requests.length, 1); assert.equal(requests[0][0], 9);
  assert.equal(requests[0][1].ownerIds[0], 2); assert.equal(requests[0][1].deptId, 3);
});

test('closed task approvals cannot be processed even if a stale API permission flag remains true', async () => {
  let mutations = 0;
  const state = setup('components/TaskApprovalDetail.vue', { taskId: 3, kind: 'confirm' }, {
    '@/stores/auth': { useAuthStore: () => ({ readOnly: false }) },
    '@/stores/refresh': { useRefreshStore: () => ({ markTaskChanged() {} }) },
    'vue-router': { useRouter: () => ({ push() {} }) },
    '@/api': { dashboardApi: { taskApprovalDetail: async () => ({ taskId: 3, kind: 'confirm', status: 'cancelled', canReview: true }) }, tasksApi: { confirm: async () => { mutations++; }, reject: async () => { mutations++; } } },
    'element-plus': { ElMessage: { success() {}, error() {} }, ElMessageBox: { confirm: async () => {}, prompt: async () => ({ value: 'reason' }) } },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.detail.value.status, 'cancelled');
  assert.equal(state.canReview.value, false);
  await state.confirm(true); await state.confirm(false);
  assert.equal(mutations, 0);
  state.detail.value = { ...state.detail.value, status: 'pending' };
  assert.equal(state.canReview.value, true);
});
