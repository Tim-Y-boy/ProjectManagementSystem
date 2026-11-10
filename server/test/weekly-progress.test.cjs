// Run: node -r ts-node/register/transpile-only --test test/weekly-progress.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { beijingDate, weekStart, requiredWeeks, progressSatisfiesWeek } = require('../src/modules/tasks/weekly-progress.rules');
const task = (status = 'doing') => ({ status, created_at: '2026-09-01T00:00:00+08:00' });
const enabled = '2026-09-09T12:00:00+08:00';
const monday = new Date('2026-09-14T09:00:00+08:00');
const none = new Map();

test('Beijing Sunday/Monday boundary determines week and retains Friday reminders', () => {
  assert.equal(weekStart(beijingDate('2026-09-13T15:59:59Z')), '2026-09-07');
  assert.equal(weekStart(beijingDate('2026-09-13T16:00:00Z')), '2026-09-14');
  assert.deepEqual(requiredWeeks(task(), [], enabled, new Date('2026-09-13T23:59:59+08:00'), none), ['2026-09-07']);
  assert.deepEqual(requiredWeeks(task(), [], enabled, monday, none), ['2026-09-07']);
});

test('activation excludes earlier weeks and counts only workdays after activation', () => {
  assert.deepEqual(requiredWeeks(task(), [], enabled, monday, none), ['2026-09-07']);
  assert.deepEqual(requiredWeeks(task(), [], '2026-09-12T12:00:00+08:00', monday, none), []);
  assert.deepEqual(requiredWeeks(task(), [], '2026-09-12T12:00:00+08:00', monday, new Map([['2026-09-12', 'makeup']])), ['2026-09-07']);
});

test('completion retains the doing week; completion and reopening history does not invent doing weeks', () => {
  const logs = [
    { created_at: '2026-09-10T09:00:00+08:00', from_status: 'todo', to_status: 'doing' },
    { created_at: '2026-09-11T17:00:00+08:00', from_status: 'doing', to_status: 'done' },
    { created_at: '2026-09-22T09:00:00+08:00', from_status: 'done', to_status: 'doing' },
  ];
  assert.deepEqual(requiredWeeks(task('done'), logs.slice(0, 2), enabled, monday, none), ['2026-09-07']);
  assert.deepEqual(requiredWeeks(task(), logs, enabled, new Date('2026-09-28T09:00:00+08:00'), none), ['2026-09-07', '2026-09-21']);
});

test('holidays suppress wholly idle weeks; reading outstanding work does not depend on Monday being a workday', () => {
  const holidays = new Map(['07', '08', '09', '10', '11'].map(day => [`2026-09-${day}`, 'holiday']));
  assert.deepEqual(requiredWeeks(task(), [], enabled, monday, holidays), []);
  assert.deepEqual(requiredWeeks(task(), [], enabled, monday, new Map([['2026-09-14', 'holiday']])), ['2026-09-07']);
  assert.deepEqual(requiredWeeks(task(), [], enabled, new Date('2026-09-15T09:00:00+08:00'), new Map([['2026-09-14', 'holiday']])), ['2026-09-07']);
});

test('current week becomes due on Friday at 14:00 Beijing and includes older missing weeks', () => {
  assert.deepEqual(requiredWeeks(task(), [], enabled, new Date('2026-09-11T05:59:59Z'), none), []);
  assert.deepEqual(requiredWeeks(task(), [], enabled, new Date('2026-09-11T06:00:00Z'), none), ['2026-09-07']);
  assert.deepEqual(requiredWeeks(task(), [], enabled, new Date('2026-09-18T06:00:00Z'), none), ['2026-09-07', '2026-09-14']);
});

test('work_date decides satisfaction; any author and late entry satisfy the same week', () => {
  for (const user_id of [1, 2]) {
    assert.equal(progressSatisfiesWeek({ user_id, work_date: '2026-09-13', content: '完成联调', created_at: '2026-09-16T01:00:00Z' }, '2026-09-07'), true);
  }
  assert.equal(progressSatisfiesWeek({ work_date: '2026-09-14', content: '本周内容' }, '2026-09-07'), false);
  assert.equal(progressSatisfiesWeek({ work_date: '2026-09-10', content: '  ' }, '2026-09-07'), false);
});
