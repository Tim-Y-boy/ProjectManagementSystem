const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reasonableSupplementDisabledReason: disabledReason } = require('../src/modules/tasks/reasonable-supplement');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const deadline = '2026-09-20';
const before = '未超过任务截止日期，无需确认合理补填';
const lateWork = '工作日期已超过任务截止日期，不能确认为合理补填。';
const eligible = { id: 1, taskId: 533, workDate: '2026-09-19', createdAt: new Date('2026-09-22T01:00:00Z'), status: 'supplemented' };

test('submissions on/before deadline are disabled through 23:59:59 Beijing time', () => {
  for (const createdAt of ['2026-09-19T01:00:00Z', '2026-09-20T00:00:00+08:00', '2026-09-20T15:59:59.999Z']) {
    assert.equal(disabledReason(deadline, { ...eligible, createdAt }), before);
  }
});
test('late submission of on-time work is eligible from next Beijing calendar day', () => {
  for (const workDate of ['2026-09-19', deadline]) {
    for (const createdAt of ['2026-09-20T16:00:00Z', '2026-09-21T00:00:00+08:00', eligible.createdAt]) {
      assert.equal(disabledReason(deadline, { workDate, createdAt }), '');
    }
  }
});
test('work after deadline is actual delay even if its record was submitted earlier', () => {
  for (const createdAt of ['2026-09-19T00:00:00Z', eligible.createdAt]) {
    assert.equal(disabledReason(deadline, { workDate: '2026-09-21', createdAt }), lateWork);
  }
});
test('eligibility uses original createdAt, not edit time; absent and invalid dates stay disabled', () => {
  assert.equal(disabledReason(deadline, { ...eligible, createdAt: '2026-09-19T01:00:00Z', updatedAt: '2026-09-22T01:00:00Z' }), before);
  for (const due of [null, '', 'invalid', '2026-02-30']) assert.ok(disabledReason(due, eligible));
  for (const change of [{ workDate: null }, { workDate: '2026-02-30' }, { createdAt: null }, { createdAt: 'invalid' }]) {
    assert.ok(disabledReason(deadline, { ...eligible, ...change }));
  }
  assert.equal(disabledReason('2026-12-31', { workDate: '2026-12-31', createdAt: '2026-12-31T16:00:00Z' }), '');
});

function fixture(update = {}, manager = true) {
  const row = { ...eligible, ...update };
  const task = { id: 533, projectId: 16, status: 'done', dueAt: deadline };
  const saved = [], logs = [];
  const service = Object.create(TasksService.prototype);
  service.tasks = { findOne: async () => task };
  service.projects = { findOne: async () => ({ id: 16, planLocked: true, status: 'active' }) };
  service.dailyUpdates = { findOne: async () => row, find: async () => [row], save: async value => { saved.push({ ...value }); return value; } };
  service.assets = { find: async () => [] };
  service.getTask = async () => task;
  service.canManageProject = async () => manager;
  service.addLog = async (...args) => logs.push(args);
  const delegated = [];
  service.closures = {
    markSupplement: async (...args) => {
      delegated.push(['mark', ...args]);
      return { ...row, status: 'exempted', exemptReason: args[3] };
    },
    revokeSupplement: async (...args) => {
      delegated.push(['revoke', ...args]);
      return { ...row, status: args[3], exemptReason: null };
    },
  };
  return { service, row, saved, logs, delegated };
}
const actor = { userId: 1, roles: ['admin'] };
test('API rejects early submissions and late work even for admin without saving or logging', async () => {
  for (const [change, message] of [[{ createdAt: '2026-09-20T15:59:59Z' }, before], [{ workDate: '2026-09-21' }, lateWork]]) {
    const f = fixture(change);
    await assert.rejects(f.service.exemptDailyUpdate(actor, 533, 1), { message, status: 400 });
    assert.equal(f.saved.length, 0);
    assert.equal(f.logs.length, 0);
    assert.equal(f.row.status, 'supplemented');
    assert.equal(f.delegated.length, 0);
  }
});
test('API accepts eligible record and returns the same eligibility reason in the list', async () => {
  const f = fixture();
  const list = await f.service.listDailyUpdates(actor, 533);
  assert.equal(list[0].exemptDisabledReason, '');
  const saved = await f.service.exemptDailyUpdate(actor, 533, 1, '按时完成，事后补录');
  assert.equal(saved.status, 'exempted');
  assert.equal(saved.exemptReason, '按时完成，事后补录');
  assert.deepEqual(f.delegated, [['mark', actor, 533, 1, '按时完成，事后补录']]);
  const rejected = fixture({ workDate: '2026-09-21' });
  assert.equal((await rejected.service.listDailyUpdates(actor, 533))[0].exemptDisabledReason, lateWork);
});
test('async project permission is enforced for confirmation and reversal', async () => {
  const f = fixture({}, false);
  await assert.rejects(f.service.exemptDailyUpdate(actor, 533, 1), { status: 403 });
  await assert.rejects(f.service.unexemptDailyUpdate(actor, 533, 1), { status: 403 });
  assert.equal(f.saved.length, 0);
});
test('historically exempted records remain reversible without passing new eligibility rules', async () => {
  const f = fixture({ status: 'exempted', workDate: '2026-09-21', exemptReason: '历史记录' });
  const result = await f.service.unexemptDailyUpdate(actor, 533, 1);
  assert.notEqual(result.status, 'exempted');
  assert.equal(result.exemptReason, null);
  assert.deepEqual(f.delegated, [['revoke', actor, 533, 1, result.status]]);
});

// A single exempted week must not exempt the rest of the task's late entries.
function summaryFixture(rows, dueAt = '2026-09-15') {
  const service = Object.create(TasksService.prototype);
  service.tasks = { find: async () => [{ id: 266, dueAt }] };
  service.dailyUpdates = { find: async ({ where }) => rows.filter(row =>
    where.taskId.value.map(Number).includes(Number(row.taskId)) &&
    (!where.status || row.status === where.status)) };
  return service;
}
const weekRecord = (workDate, status, createdAt = '2026-10-09T01:00:00Z') => ({
  taskId: '266', workDate, status, createdAt, content: '测试',
});
test('task summary stays delayed when only the first of three late progress entries is exempted', async () => {
  const service = summaryFixture([
    weekRecord('2026-09-04', 'exempted'),
    weekRecord('2026-09-07', 'supplemented'),
    weekRecord('2026-09-14', 'supplemented'),
  ]);
  assert.equal((await service.exemptedTaskIds([266])).has(266), false);
});
test('task summary becomes reasonably supplemented only after all late submissions are confirmed, and reversal removes it', async () => {
  const rows = ['2026-09-04', '2026-09-07', '2026-09-14'].map(date => weekRecord(date, 'exempted'));
  const service = summaryFixture(rows);
  assert.equal((await service.exemptedTaskIds([266])).has(266), true);
  rows[1].status = 'supplemented';
  assert.equal((await service.exemptedTaskIds([266])).has(266), false);
});
test('on-time entries need no exemption, including before-deadline backfills', async () => {
  const service = summaryFixture([
    weekRecord('2026-09-04', 'normal', '2026-09-04T01:00:00Z'),
    weekRecord('2026-09-07', 'supplemented', '2026-09-15T15:59:59.999Z'),
    weekRecord('2026-09-14', 'exempted'),
  ]);
  assert.equal((await service.exemptedTaskIds([266])).has(266), true);
});
test('normal status cannot hide a late submission at the Beijing deadline boundary', async () => {
  const service = summaryFixture([
    weekRecord('2026-09-04', 'exempted'),
    weekRecord('2026-09-15', 'normal', '2026-09-15T16:00:00Z'),
  ]);
  assert.equal((await service.exemptedTaskIds([266])).has(266), false);
});
test('work after the deadline and invalid historical exemptions cannot exempt a task', async () => {
  for (const row of [weekRecord('2026-09-16', 'normal'), weekRecord('2026-09-16', 'exempted'), weekRecord('2026-09-14', 'exempted', null)]) {
    const service = summaryFixture([weekRecord('2026-09-04', 'exempted'), row]);
    assert.equal((await service.exemptedTaskIds([266])).has(266), false);
  }
});
test('empty history, no confirmed supplement and missing deadline never produce the exemption badge', async () => {
  for (const rows of [[], [weekRecord('2026-09-04', 'normal', '2026-09-04T01:00:00Z')]]) {
    assert.equal((await summaryFixture(rows).exemptedTaskIds([266])).has(266), false);
  }
  assert.equal((await summaryFixture([weekRecord('2026-09-04', 'exempted')], null).exemptedTaskIds([266])).has(266), false);
});
