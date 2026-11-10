const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const utility = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/todo-inbox.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, utility);
function fixture(props = {}) {
  const raw = parse(fs.readFileSync(path.join(__dirname, '../src/components/todo/TodoInbox.vue'), 'utf8')).descriptor.scriptSetup.content;
  const source = ts.createSourceFile('inbox.ts', raw, ts.ScriptTarget.Latest, true);
  const code = source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source)).join('\n');
  const route = vue.reactive({ query: { tab: 'inform' } });
  const rows = vue.ref([
    { key: 'notice-1', category: 'inform', noticeId: 1 },
    { key: 'notice-2', category: 'inform', noticeId: 2, done: true },
    { key: 'accept-3', category: 'approve', taskId: 3, approvalType: 'accept' },
    { key: 'change-4', category: 'approve', approvalType: 'change' },
  ]);
  const context = { ...vue, ...utility.exports, watch: () => {}, defineProps: () => props,
    useRoute: () => route, useRouter: () => ({ replace: async value => { route.query = value.query; } }),
    useTodoInbox: () => ({ data: vue.ref({}), rows, counts: vue.computed(() => utility.exports.inboxCounts(rows.value)), errors: vue.ref([]), loading: vue.ref(false), reload: async () => {} }),
    closuresApi: { acknowledge: async id => { rows.value.find(r => r.noticeId === id).done = true; } },
    ElMessage: { success() {}, error() {} },
  };
  vm.runInNewContext(ts.transpileModule(code + '\nglobalThis.subject = { visible, acknowledge, informCounts };', { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText, context);
  return { ...context.subject, route };
}
test('pending and acknowledged notifications are separate, acknowledgement moves one item', async () => {
  const f = fixture();
  assert.equal(f.visible.value.map(r => r.key).join(','), 'notice-1');
  f.route.query.notice = '1';
  await f.acknowledge(f.visible.value[0]);
  assert.equal(f.visible.value.length, 0);
  assert.equal(f.route.query.notice, undefined);
  f.route.query.read = 'done';
  assert.equal(f.visible.value.length, 2);
  assert.equal(f.informCounts.value.pending, 0);
});
test('approval center and personal approval tab expose the same pending items', () => {
  const personal = fixture(); personal.route.query.tab = 'approve';
  const center = fixture({ approvalOnly: true });
  assert.equal(personal.visible.value.map(r => r.key).join(','), center.visible.value.map(r => r.key).join(','));
  assert.equal(fixture({ approvalOnly: true, approvalType: 'accept' }).visible.value[0].key, 'accept-3');
  assert.equal(fixture({ approvalOnly: true, approvalType: 'accept' }).visible.value.length, 1);
});
