const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse } = require('@vue/compiler-sfc');

const file = path.join(__dirname, '../src/views/Tasks.vue');
const script = parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content;
const source = ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true);
const names = ['canModifyDailyUpdate', 'canDeleteDailyUpdate'];
const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
assert.equal(functions.length, 2);
const code = ts.transpileModule(functions.map(n => n.getText(source)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function permissions({ admin = false, status = 'done', archived = false, locked = true, parent = false, frozen = false } = {}) {
  const context = { detail: { value: { status, projectStatus: archived ? 'archived' : 'active' } }, isDetailParent: { value: parent }, isDetailProjectLocked: { value: locked }, isAdminLeader: { value: admin }, canManageDetailDept: { value: false }, auth: { user: { id: 1 }, has: r => r === 'admin' && admin } };
  vm.createContext(context);
  context.isDetailFrozen = { value: frozen };
  vm.runInContext(code, context);
  return context;
}
test('completed-task administrator can delete ordinary records but cannot edit or delete exempted records', () => {
  const p = permissions({ admin: true });
  assert.equal(p.canDeleteDailyUpdate({ userId: '1', status: 'normal' }), true);
  assert.equal(p.canModifyDailyUpdate({ userId: '1', status: 'normal' }), false);
  assert.equal(p.canDeleteDailyUpdate({ userId: '1', status: 'exempted' }), false);
});

test('closure freeze blocks administrator deletion even when the task is completed', () => {
  for (const status of ['doing', 'done']) {
    const p = permissions({ admin: true, frozen: true, status });
    assert.equal(p.canDeleteDailyUpdate({ userId: '1', status: 'normal' }), false);
  }
});
test('ordinary author, archived/unfinalized project and parent restrictions remain', () => {
  for (const options of [{}, { admin: true, archived: true }, { admin: true, locked: false }, { admin: true, parent: true }, { admin: true, status: 'pending_accept' }]) {
    assert.equal(permissions(options).canDeleteDailyUpdate({ userId: '1', status: 'normal' }), false);
  }
  assert.equal(permissions({ status: 'doing' }).canDeleteDailyUpdate({ userId: '1', status: 'normal' }), true);
});
