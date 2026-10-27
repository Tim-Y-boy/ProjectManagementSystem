const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { WeeklyProgressService } = require('../src/modules/tasks/weekly-progress.service');
const { SCHEDULE_CRON_OPTIONS } = require('@nestjs/schedule/dist/schedule.constants');

async function runAt(iso, holidays = []) {
  const calls = [];
  const service = new WeeklyProgressService({ manager: { query: async () => holidays } }, {});
  service.collect = async () => { calls.push('collect'); };
  service.dispatch = async () => { calls.push('dispatch'); };
  const NativeDate = global.Date;
  global.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [iso])); } };
  try { await service.scheduledCheck(); } finally { global.Date = NativeDate; }
  return calls;
}

test('cron is Friday 14:00 in Beijing, not an hourly weekday reminder', () => {
  const cron = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, WeeklyProgressService.prototype.scheduledCheck);
  assert.equal(cron.cronTime, '0 0 14 * * 5');
  assert.equal(cron.timeZone, 'Asia/Shanghai');
});

test('only Friday 14:00 can collect and dispatch, including UTC conversion', async () => {
  assert.deepEqual(await runAt('2026-10-16T06:00:00Z'), ['collect', 'dispatch']);
  for (const time of ['2026-10-12T09:15:00+08:00', '2026-10-16T13:59:00+08:00', '2026-10-16T14:15:00+08:00', '2026-10-17T14:00:00+08:00']) {
    assert.deepEqual(await runAt(time), [], time);
  }
});

test('a holiday Friday is skipped without moving the reminder to Monday or a makeup weekend', async () => {
  const holidays = [{ date: '2026-10-16', kind: 'holiday' }, { date: '2026-10-17', kind: 'makeup' }];
  assert.deepEqual(await runAt('2026-10-16T14:00:00+08:00', holidays), []);
  assert.deepEqual(await runAt('2026-10-17T14:00:00+08:00', holidays), []);
  assert.deepEqual(await runAt('2026-10-19T14:00:00+08:00', holidays), []);
});
