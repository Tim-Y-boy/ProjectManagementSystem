const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/utils/date-time.ts'), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText, context);
const { formatBeijingTime } = context.exports;

test('UTC application and approval times display in Beijing time', () => {
  assert.equal(formatBeijingTime('2026-09-16T05:46:00.000Z'), '2026-09-16 13:46');
  assert.equal(formatBeijingTime('2026-09-16T06:07:00.000Z'), '2026-09-16 14:07');
  assert.equal(formatBeijingTime('2026-09-16T08:52:00.000Z'), '2026-09-16 16:52');
});
test('offset timestamps are not shifted twice and midnight rolls to the next date', () => {
  assert.equal(formatBeijingTime('2026-09-16T13:46:00+08:00'), '2026-09-16 13:46');
  assert.equal(formatBeijingTime('2026-12-31T16:00:00Z'), '2027-01-01 00:00');
});
test('missing and invalid timestamps do not display Invalid Date', () => {
  for (const value of [null, undefined, '', 'invalid']) assert.equal(formatBeijingTime(value), '—');
});
