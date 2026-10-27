const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');
function fixture({ status = 'pending_accept', missing = false, reason = '', files = [], fail = false, readonly = false } = {}) {
  const script = parse(fs.readFileSync(path.join(__dirname, '../src/components/todo/TaskApprovalPanel.vue'), 'utf8')).descriptor.scriptSetup.content;
  const source = ts.createSourceFile('panel.ts', script, ts.ScriptTarget.Latest, true);
  const code = source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source)).join('\n');
  const calls = [], emitted = [], confirms = [];
  const context = {
    ref: value => ({ value }), watch: () => {}, defineProps: () => ({ taskId: 12, readonly }), defineEmits: () => event => emitted.push(event),
    tasksApi: { one: async () => { if (fail) throw Error('load failed'); return { status, materialExemptionReason: reason }; }, dailyUpdates: async () => [], assets: async () => files, transition: async (...args) => calls.push(args) },
    ElMessage: { info() {}, warning() {}, error() {}, success() {} },
    ElMessageBox: { confirm: async text => confirms.push(text), prompt: async () => ({ value: '补充资料' }) },
    checkWeeklyProgressBeforeAcceptance: async () => !missing,
    assetLinkUrl: asset => /^https?:/.test(asset.url || '') ? asset.url : '',
  };
  vm.runInNewContext(ts.transpileModule(code + '\n;globalThis.subject = { review };', { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText, context);
  return { ...context.subject, calls, emitted, confirms };
}
test('approval checks latest state, missing weeks and material evidence', async () => {
  for (const options of [{ status: 'done' }, { missing: true }, {}, { fail: true }]) {
    const f = fixture(options); await f.review(true); assert.equal(f.calls.length, 0);
  }
  const f = fixture({ reason: '过程性工作，无独立文件' });
  await f.review(true);
  assert.match(f.confirms[0], /过程性工作/);
  assert.equal(f.calls[0][1], 'done');
  assert.ok(f.emitted.includes('reviewed'));
});
test('material-backed approval and return use existing transition API', async () => {
  const f = fixture({ files: [{ filePath: '/file' }] });
  await f.review(true); assert.equal(f.calls[0][1], 'done');
  const returned = fixture(); await returned.review(false);
  assert.equal(returned.calls[0][1], 'doing');
  assert.equal(returned.calls[0][2], '补充资料');
});

test('historical and participant-only detail cannot submit review actions', async () => {
  const f = fixture({ readonly: true, files: [{ filePath: '/file' }] });
  await f.review(true); await f.review(false);
  assert.equal(f.calls.length, 0); assert.equal(f.confirms.length, 0);
});
