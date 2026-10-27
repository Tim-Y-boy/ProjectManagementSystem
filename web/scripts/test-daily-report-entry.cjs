const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');

test('entry ignores old link dates and cached history, loads newest on reactivation', async () => {
  const calls = [];
  let mount, activate;
  const script = parse(fs.readFileSync(path.join(__dirname, '../src/views/DailyReport.vue'), 'utf8')).descriptor.scriptSetup.content;
  const context = {
    ...vue,
    onMounted: fn => { mount = fn; }, onActivated: fn => { activate = fn; },
    useRoute: () => ({ query: { date: '2026-10-01' }, meta: {} }),
    useRefreshStore: () => ({ versions: { task: 0, project: 0 } }),
    useDailyReportStore: () => ({ date: '2026-10-16', markSeen() {} }),
    formatBeijingTime: () => '2026-10-21 09:00:00',
    groupDailyReport: () => [],
    dashboardApi: { dailyReport: async date => {
      calls.push(date);
      return { date: date || '2026-10-20', items: [] };
    } },
  };
  const code = script.replace(/^import .*;\r?$/gm, '') + '\nglobalThis.page = { date, load, query };';
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText, context);
  await mount();
  activate();
  assert.deepEqual(calls, [undefined]);
  assert.equal(context.page.date.value, '2026-10-20');
  await context.page.load('2026-10-15');
  context.page.query.value = 'old search';
  activate();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [undefined, '2026-10-15', undefined]);
  assert.equal(context.page.date.value, '2026-10-20');
  assert.equal(context.page.query.value, '');
});
