const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
function guard({ mobile = true, loggedIn = true } = {}) {
  const raw = fs.readFileSync(path.join(__dirname, '../src/router/index.ts'), 'utf8');
  const source = ts.createSourceFile('router.ts', raw, ts.ScriptTarget.Latest, true);
  const code = source.statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getText(source)).join('\n');
  let callback;
  const context = { exports: {}, createWebHistory: () => ({}), createRouter: () => ({ beforeEach: fn => { callback = fn; } }),
    useAuthStore: () => ({ isLoggedIn: loggedIn, user: { id: 1 }, has: () => true }),
    window: { matchMedia: () => ({ matches: mobile }) },
  };
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, context);
  return callback;
}
test('mobile notification links preserve task, week, approval, request and project identity', async () => {
  const run = guard();
  for (const [path, query, expected, key, value] of [
    ['/tasks', { taskId: '12', weekStart: '2026-10-05' }, '/mobile/task/12', 'weekStart', '2026-10-05'],
    ['/my-todo', { tab: 'approve', taskId: '12' }, '/mobile/todo', 'taskId', '12'],
    ['/plan-changes', { changeId: '7' }, '/mobile/plan-changes', 'changeId', '7'],
    ['/approvals', { taskId: '12' }, '/mobile/approve', 'taskId', '12'],
    ['/closures', { request: '8' }, '/mobile/closures', 'request', '8'],
    ['/closure-reports', { request: '8' }, '/mobile/closure-reports', 'request', '8'],
    ['/projects/9', {}, '/mobile/tasks', 'projectId', '9'],
    ['/tasks', { projectId: '9' }, '/mobile/tasks', 'projectId', '9'],
  ]) {
    const result = await run({ path, query, meta: {} });
    assert.equal(result.path, expected); assert.equal(result.query[key], value);
  }
});
test('login retains the entire notification destination', async () => {
  const fullPath = '/mobile/todo?tab=approve&taskId=12';
  const result = await guard({ loggedIn: false })({ path: '/mobile/todo', fullPath, meta: {} });
  assert.equal(result.name, 'login'); assert.equal(result.query.redirect, fullPath);
});
