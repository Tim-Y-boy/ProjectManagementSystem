const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/task-progress-week.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, context);
const info = context.exports.taskProgressWeek;

test('planned calendar weeks match acceptance including partial first/last weeks', () => {
  assert.equal(info('2026-09-01', '2026-09-04').label, '任务第 1 周');
  assert.equal(info('2026-09-01', '2026-09-08').label, '任务第 2 周');
  assert.equal(info('2026-09-01', '2026-09-15').label, '任务第 3 周');
  assert.equal(info('2026-09-01', '2026-10-09').label, '任务第 6 周');
  assert.equal(info('2026-09-01', '2026-09-04').range, '2026-09-01 至 2026-09-06');
});

test('Sunday and Monday, cross-year dates and changed work dates give correct week numbers', () => {
  assert.equal(info('2026-09-01', '2026-09-06').number, 1);
  assert.equal(info('2026-09-01', '2026-09-07').number, 2);
  assert.equal(info('2026-12-31', '2027-01-04').number, 2);
});

test('dates before planned start and missing dates never invent a week number', () => {
  assert.equal(info('2026-09-03', '2026-09-01').label, '计划开始前');
  assert.equal(info('', '2026-09-04').label, '未设置计划开始日期');
  assert.equal(info('2026-09-01', '').label, '请选择工作日期');
  assert.equal(info('2026-09-01', '2026-02-30').number, null);
});


test('deadline bounds last-week label and dates after it do not invent more task weeks', () => {
  assert.equal(info('2026-09-01', '2026-09-15', '2026-09-15').label, '任务第 3 周');
  assert.equal(info('2026-09-01', '2026-09-15', '2026-09-15').range, '2026-09-14 至 2026-09-15');
  assert.equal(info('2026-09-01', '2026-10-09', '2026-09-15').label, '任务截止后');
  assert.equal(info('2026-09-01', '2026-10-09', '2026-09-15').number, null);
});
