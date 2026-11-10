const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveWeeklyReportOwner: resolve } = require('../src/modules/tasks/weekly-report-owner');
test('single owner is automatic and cannot be replaced by another user', () => {
  assert.equal(resolve([16], undefined, 19), 16);
  assert.equal(resolve([16], '16'), 16);
  assert.throws(() => resolve([16], 19), /唯一/);
});
test('multiple owners require a member, preserve a valid choice, and reject a removed owner', () => {
  assert.equal(resolve([16,19], 19), 19);
  assert.equal(resolve([16,19], undefined, 19), 19);
  assert.throws(() => resolve([16,19], undefined), /选择/);
  assert.throws(() => resolve([16,19], 20), /选择/);
  assert.throws(() => resolve([16,19], null), /选择/);
  assert.throws(() => resolve([16,19], undefined, 20), /选择/);
});
