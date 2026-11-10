const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function setup(options = {}) {
  const exports = {};
  const source = fs.readFileSync(require('node:path').join(__dirname, '../src/utils/app-version.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, URL });
  const redirected = [];
  const check = exports.createVersionCheck({ current: 'old', url: () => 'https://example.test/projects/42?from=group#detail',
    read: async () => 'new', replace: url => redirected.push(url), canReload: () => true, ...options });
  return { check, redirected };
}
test('new version preserves group project, query and hash and reloads once', async () => {
  const { check, redirected } = setup();
  await check(); await check();
  assert.equal(redirected.length, 1);
  const url = new URL(redirected[0]);
  assert.equal(url.pathname, '/projects/42');
  assert.equal(url.searchParams.get('from'), 'group');
  assert.equal(url.hash, '#detail');
  assert.equal(url.searchParams.get('_appv'), 'new');
});
test('same version and failed checks do not reload', async () => {
  for (const read of [async () => 'old', async () => { throw Error('offline'); }]) {
    const { check, redirected } = setup({ read });
    await check(); assert.equal(redirected.length, 0);
  }
});
test('stale response after redirect cannot cause a reload loop', async () => {
  const { check, redirected } = setup({ url: () => 'https://example.test/mobile/tasks?_appv=new' });
  await check(); assert.equal(redirected.length, 0);
});
test('editing defers reload until safe; concurrent checks coalesce', async () => {
  let editing = true;
  const { check, redirected } = setup({ canReload: () => !editing });
  await check(); assert.equal(redirected.length, 0);
  editing = false;
  await Promise.all([check(), check()]); assert.equal(redirected.length, 1);
});
