// Run from web: node --test scripts/test-task-actions.cjs
// Render the real TaskRow SFC with isolated auth and display-only dependencies.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse, compileScript } = require('@vue/compiler-sfc');
const { createSSRApp, h } = require('vue');
const { renderToString } = require('@vue/server-renderer');

function sourceModule(file, requireFn) {
  const source = fs.readFileSync(file, 'utf8');
  const content = file.endsWith('.vue')
    ? compileScript(parse(source, { filename: file }).descriptor, { id: 'completion-tag-test', inlineTemplate: true }).content
    : source;
  const code = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const mod = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(requireFn, mod, mod.exports);
  return mod.exports;
}

async function render({ uid = 16, roles = ['member'], owner = false, status = 'todo', locked = true, frozen = false, children = [], creatorId = '219', canReopenCompleted = false, dueAt = null, completedAt = null } = {}) {
  const file = path.join(__dirname, '../src/views/TaskRow.vue');
  const { descriptor } = parse(fs.readFileSync(file, 'utf8'), { filename: file });
  const script = compileScript(descriptor, { id: 'task-actions-test', inlineTemplate: true });
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const auth = { user: { id: uid }, has: (role) => roles.includes(role) };
  const mod = { exports: {} };
  const isolatedRequire = (id) => {
    if (id === '@/stores/auth') return { useAuthStore: () => auth };
    if (id === '@/utils/task-dates') return { deriveTaskRange: (task) => task };
    if (id === '@/utils/task-risk') return sourceModule(path.join(__dirname, '../src/utils/task-risk.ts'), require);
    if (id === '@/components/TaskCompletionTag.vue') return sourceModule(path.join(__dirname, '../src/components/TaskCompletionTag.vue'), isolatedRequire);
    if (id === './TaskRow.vue') return { default: { render: () => h('div') } };
    if (id === 'element-plus') return { ElMessageBox: {} };
    return require(id);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(isolatedRequire, mod, mod.exports);
  const app = createSSRApp(mod.exports.default, {
    task: { id: 533, projectId: 16, title: '项目方案定稿', creatorId, assigneeIds: ['193', '219'], acceptorIds: ['30'], status, children, canReopenCompleted, dueAt, completedAt },
    depth: 0, collapsedTasks: new Set(), projectLocked: locked, projectFrozen: frozen, isProjectOwner: owner,
    editableProjectIds: new Set(owner ? [16] : []), creatableProjectIds: new Set(),
    userName: String, statusLabel: String, statusType: () => 'info', pct: () => 0,
    openDetail() {}, openCreate() {}, openEdit() {}, confirm() {}, reject() {}, act() {}, removeTask() {}, isAdminLeader: false,
  });
  for (const name of ['el-button', 'el-tag', 'el-progress', 'el-icon']) {
    app.component(name, { setup: (_, { slots }) => () => h(name === 'el-button' ? 'button' : 'span', slots.default?.()) });
  }
  return renderToString(app);
}

test('project owner sees start on task created by another member', async () => {
  assert.match(await render({ owner: true }), />开始</);
  assert.doesNotMatch(await render(), />开始</);
});
test('creator and executor retain start permission', async () => {
  assert.match(await render({ uid: 219 }), />开始</);
  assert.match(await render({ uid: 193 }), />开始</);
});
test('task acceptor sees start, progress and submission without being project owner', async () => {
  assert.match(await render({ uid: 30 }), />开始</);
  const html = await render({ uid: 30, status: 'doing' });
  assert.match(html, />填进展</);
  assert.match(html, />提交验收</);
  assert.doesNotMatch(await render({ uid: 30, locked: false }), />开始</);
});
test('rejected tasks expose restore to executors, owner, acceptor and admin/leader', async () => {
  for (const opts of [{ uid: 193 }, { uid: 219 }, { owner: true }, { uid: 30 }, { roles: ['admin'] }, { roles: ['leader'] }]) {
    assert.match(await render({ ...opts, status: 'rejected' }), />恢复待办</);
  }
  assert.doesNotMatch(await render({ uid: 88, creatorId: '88', status: 'rejected' }), />恢复待办</);
  assert.doesNotMatch(await render({ uid: 99, status: 'rejected' }), />恢复待办</);
});
test('project owner sees progress entry and submission after starting', async () => {
  const html = await render({ owner: true, status: 'doing' });
  assert.match(html, />填进展</);
  assert.match(html, />提交验收</);
});
test('executor sees progress entry with string IDs returned by PostgreSQL', async () => {
  assert.match(await render({ uid: 193, status: 'doing' }), />填进展</);
});
test('owner does not gain acceptance, parent execution or unlocked-project execution', async () => {
  assert.doesNotMatch(await render({ owner: true, status: 'pending_accept' }), />通过</);
  assert.doesNotMatch(await render({ owner: true, locked: false }), />开始</);
  assert.doesNotMatch(await render({ owner: true, status: 'rejected', children: [{ id: 534, status: 'todo' }] }), />恢复待办</);
});
test('closure freeze leaves details readable and hides all task mutation entries', async () => {
  for (const status of ['todo', 'doing', 'done', 'pending_accept', 'rejected']) {
    const html = await render({ owner: true, roles: ['admin'], uid: 30, status, frozen: true, canReopenCompleted: true });
    assert.match(html, />详情</);
    assert.doesNotMatch(html, />(开始|填进展|补进展|补资料|资料|恢复待办|提交验收|通过|退回|退回进行中|编辑|删除)</);
  }
});

test('completed-task return button follows server capability and remains leaf-only', async () => {
  assert.match(await render({ status: 'done', canReopenCompleted: true }), />退回</);
  assert.doesNotMatch(await render({ status: 'done', roles: ['leader'], owner: true }), />退回</);
  assert.doesNotMatch(await render({ status: 'doing', canReopenCompleted: true }), />退回</);
  assert.doesNotMatch(await render({ status: 'done', canReopenCompleted: true, locked: false }), />退回</);
  assert.doesNotMatch(await render({ status: 'done', canReopenCompleted: true, children: [{ status: 'done' }] }), />退回</);
});

test('real task row renders early days, never shows early and late together, and clears early label after return', async () => {
  const dates = { dueAt: '2026-09-21', completedAt: '2026-09-18T08:00:00Z' };
  const html = await render({ status: 'done', ...dates });
  assert.match(html, /提前 3 天完成/);
  assert.doesNotMatch(html, /延期完成/);
  assert.doesNotMatch(await render({ status: 'doing', ...dates }), /提前 \d+ 天完成/);
  assert.doesNotMatch(await render({ status: 'done', dueAt: '2026-09-21', completedAt: '2026-09-21T15:59:59Z' }), /延期完成|提前 \d+ 天完成/);
});
