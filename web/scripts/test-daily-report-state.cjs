const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { reactive, nextTick } = require('vue');
const { createPinia, setActivePinia } = require('pinia');

test('report attention clears on latest successful read, persists and isolates accounts', async () => {
  const auth = reactive({ user: { id: 1 } });
  let result = { canView: true, date: '2026-10-16' };
  const storage = new Map();
  const context = {
    exports: {},
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    require: name => name === '@/api' ? { dashboardApi: { dailyReportStatus: async () => result } }
      : name === './auth' ? { useAuthStore: () => auth } : require(name),
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/stores/dailyReport.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText, context);
  setActivePinia(createPinia());
  const store = context.exports.useDailyReportStore();
  await store.refresh();
  assert.equal(store.unread, true);
  store.markSeen('2026-10-15');
  assert.equal(store.unread, true);
  store.markSeen('2026-10-16');
  assert.equal(store.unread, false);
  await store.refresh();
  assert.equal(store.unread, false);
  result = { canView: true, date: '2026-10-19' };
  await store.refresh();
  assert.equal(store.unread, true);
  auth.user = { id: 2 };
  await nextTick();
  await store.refresh();
  assert.equal(store.unread, true);
  result = { canView: false, date: '' };
  await store.refresh();
  assert.equal(store.allowed, false);
  assert.equal(store.unread, false);
});
