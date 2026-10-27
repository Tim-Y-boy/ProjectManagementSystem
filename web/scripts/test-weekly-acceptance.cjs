const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { renderToString } = require('@vue/server-renderer');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/weekly-acceptance.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
function fixture(weeks, action) {
  const confirms = [], fills = [], calls = [];
  const context = { exports: {}, require: name => {
    if (name === 'vue') return vue;
    if (name === 'element-plus') return { ElMessageBox: { confirm: async (...args) => {
      confirms.push(args); if (action) throw action;
    } } };
    if (name === '@/api') return { tasksApi: { missingWeeklyProgress: async id => {
      calls.push(id); if (weeks instanceof Error) throw weeks; return { missingWeeks: weeks };
    } } };
    throw Error(name);
  } };
  vm.runInNewContext(code, context);
  return { confirms, fills, calls, check: reviewing => context.exports.checkWeeklyProgressBeforeAcceptance(264, week => fills.push(week), reviewing) };
}
const missing = [{ weekStart: '2026-09-14', weekEnd: '2026-09-20' }, { weekStart: '2026-09-28', weekEnd: '2026-10-04' }];
test('all completed weeks satisfied permits acceptance without another dialog', async () => {
  const f = fixture([]); assert.equal(await f.check(), true); assert.deepEqual(f.calls, [264]); assert.equal(f.confirms.length, 0);
});
test('missing weeks are readable and go-fill targets the earliest one without submitting', async () => {
  const f = fixture(missing); assert.equal(await f.check(), false);
  assert.deepEqual(f.fills, ['2026-09-14']);
  const html = await renderToString(f.confirms[0][0]);
  for (const date of ['2026-09-14', '2026-09-20', '2026-09-28', '2026-10-04']) assert.ok(html.includes(date));
  assert.ok(html.includes('2 周')); assert.ok(html.includes('实际工作日期'));
  assert.equal(f.confirms[0][2].confirmButtonText, '去补填');
});
test('cancel or closing the dialog cannot bypass missing weekly progress', async () => {
  for (const action of ['cancel', 'close']) {
    const f = fixture(missing, action); assert.equal(await f.check(), false); assert.equal(f.fills.length, 0);
  }
});
test('approval blocks missing weeks and explains returning instead of opening a read-only form', async () => {
  const f = fixture(missing); assert.equal(await f.check(true), false); assert.equal(f.fills.length, 0);
  assert.ok((await renderToString(f.confirms[0][0])).includes('请先退回任务'));
});
test('network failure is not treated as complete', async () => {
  const f = fixture(Error('offline')); await assert.rejects(f.check(), /offline/); assert.equal(f.fills.length, 0);
});
