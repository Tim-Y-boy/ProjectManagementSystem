// Run from server: node -r ts-node/register/transpile-only --test test/task-material-acceptance.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');

const executor = { userId: 71, roles: ['member'], deptId: 4, managedDeptIds: [] };
const acceptor = { ...executor, userId: 30 };
const admin = { ...executor, userId: 1, roles: ['admin'] };

function fixture({ status = 'doing', materials = [], reason = null, progress = 1 } = {}) {
  const task = { id: 531, projectId: 18, parentId: null, title: '现场验收', status,
    creatorId: 71, assigneeId: 71, acceptorId: 30, dueAt: '2026-10-09',
    completedAt: status === 'done' ? new Date('2026-09-10') : null, materialExemptionReason: reason };
  const logs = [], sent = [];
  const service = Object.create(TasksService.prototype);
  service.weeklyProgress = { missingWeeksForTask: async () => [] };
  service.tasks = { findOne: async () => task, count: async () => 0, save: async row => row };
  service.tasks.manager = { transaction: callback => callback({ getRepository: entity => ({
    Task: service.tasks, TaskAsset: service.assets, TaskDailyUpdate: service.dailyUpdates, TaskLog: service.logs,
  })[entity.name] }) };
  service.projects = { findOne: async () => ({ id: 18, name: '现场改造', ownerId: 16,
    deptId: 4, planLocked: true, status: 'active', closureState: 'none' }) };
  service.projectOwners = { count: async () => 0 };
  service.assignees = { find: async ({ where }) => [{ userId: where.role === 'assignee' ? 71 : 30 }] };
  service.assets = { find: async ({ where }) => materials.filter(row => row.taskId === where.taskId) };
  service.dailyUpdates = { count: async () => progress,
    find: async () => [{ content: '现场沟通完成', workDate: '2026-10-08' }] };
  service.addLog = async (...args) => logs.push(args);
  service.refreshParentStatus = async () => {};
  service.userName = async () => '执行人';
  service.systemUrl = path => `https://tracker.example${path}`;
  service.feishuNotify = { syncReviewCards: async () => {}, sendCard: async (...args) => sent.push(args) };
  return { service, task, logs, sent };
}

test('submission requires task materials or a fresh explicit reason', async () => {
  for (const reason of [undefined, '', '  ', 123, { reason: '不适用' }]) {
    const f = fixture();
    await assert.rejects(f.service.transition(executor, 531, 'pending_accept', undefined, reason), /资料|不适用/);
    assert.equal(f.task.status, 'doing');
    assert.equal(f.logs.length, 0);
    assert.equal(f.sent.length, 0);
  }
});

test('a file or valid task link allows submission and clears an old exemption', async () => {
  for (const material of [{ filePath: 'uploads/material.pdf' }, { url: 'https://example.com/spec' }]) {
    const f = fixture({ materials: [{ id: 1, taskId: 531, ...material }], reason: '旧理由' });
    await f.service.transition(executor, 531, 'pending_accept');
    assert.equal(f.task.status, 'pending_accept');
    assert.equal(f.task.materialExemptionReason, null);
  }
});

test('empty records, invalid links and another task materials cannot bypass the rule', async () => {
  for (const material of [{ taskId: 531 }, { taskId: 531, url: 'not-a-url' },
    { taskId: 531, url: 'javascript:alert(1)' }, { taskId: 532, url: 'https://example.com/spec' }]) {
    const f = fixture({ materials: [{ id: 1, ...material }] });
    await assert.rejects(f.service.transition(executor, 531, 'pending_accept'), /资料|不适用/);
    assert.equal(f.task.status, 'doing');
  }
});

test('explicit exemption is trimmed, persisted and recorded with the submission', async () => {
  const f = fixture();
  await f.service.transition(executor, 531, 'pending_accept', '请审核', '  仅现场口头协调，无可归档成果  ');
  assert.equal(f.task.status, 'pending_accept');
  assert.equal(f.task.materialExemptionReason, '仅现场口头协调，无可归档成果');
  assert.equal(f.logs[0][3].materialExemptionReason, '仅现场口头协调，无可归档成果');
  assert.equal(f.logs[0][3].comment, '请审核');
});

test('submission reuses saved progress reasons, deduplicates them, and preserves the full audit text', async () => {
  const f = fixture();
  f.service.dailyUpdates.find = async () => [
    { noMaterialReason: '  现场沟通，无文件  ' }, { noMaterialReason: '现场沟通，无文件' },
    { noMaterialReason: '现场操作，无文件' }, { noMaterialReason: null },
  ];
  await f.service.transition(executor, 531, 'pending_accept', undefined, '过时的前端原因');
  assert.equal(f.task.materialExemptionReason, ['现场沟通，无文件', '现场操作，无文件'].sort().join('\n'));
  assert.equal(f.logs[0][3].materialExemptionReason, f.task.materialExemptionReason);
  assert.match(f.sent[0][3], /现场沟通，无文件/);
  assert.match(f.sent[0][3], /现场操作，无文件/);
});

test('multiple saved progress reasons may exceed the old manual-input limit without truncation', async () => {
  const f = fixture();
  const reasons = ['甲'.repeat(500), '乙'.repeat(500), '丙'.repeat(500)];
  f.service.dailyUpdates.find = async () => reasons.map(noMaterialReason => ({ noMaterialReason }));
  await f.service.transition(executor, 531, 'pending_accept');
  assert.equal(f.task.materialExemptionReason, reasons.sort().join('\n'));
});

test('exemption notification explains missing materials and asks the acceptor to confirm', async () => {
  const f = fixture();
  await f.service.transition(executor, 531, 'pending_accept', undefined, '仅现场协调');
  assert.equal(f.sent.length, 1);
  const [, recipient, card, fallback] = f.sent[0];
  assert.equal(recipient, 30);
  for (const output of [JSON.stringify(card), fallback]) {
    assert.match(output, /无资料/);
    assert.match(output, /仅现场协调/);
    assert.match(output, /确认/);
  }
});

test('reason has a 1000-character limit and cannot waive progress', async () => {
  const f = fixture();
  await assert.rejects(f.service.transition(executor, 531, 'pending_accept', undefined, '由'.repeat(1001)), /1000/);
  assert.equal(f.task.status, 'doing');
  await f.service.transition(executor, 531, 'pending_accept', undefined, '由'.repeat(1000));
  assert.equal(f.task.materialExemptionReason.length, 1000);
  const empty = fixture({ progress: 0 });
  await assert.rejects(empty.service.transition(executor, 531, 'pending_accept', undefined, '无需资料'), /关键进展/);
});

test('returning or reopening clears the reason and resubmission requires a new one', async () => {
  for (const status of ['pending_accept', 'done']) {
    const f = fixture({ status, reason: '旧理由' });
    await f.service.transition(status === 'done' ? admin : acceptor, 531, 'doing', '需要返工');
    assert.equal(f.task.materialExemptionReason, null);
    await assert.rejects(f.service.transition(executor, 531, 'pending_accept'), /资料|不适用/);
    assert.equal(f.task.status, 'doing');
    await f.service.transition(executor, 531, 'pending_accept', undefined, '本次也仅现场协调');
    assert.equal(f.task.materialExemptionReason, '本次也仅现场协调');
  }
});

test('acceptance preserves the submitted exemption for the completed task', async () => {
  const f = fixture({ status: 'pending_accept', reason: '仅现场协调' });
  await f.service.transition(acceptor, 531, 'done');
  assert.equal(f.task.status, 'done');
  assert.equal(f.task.materialExemptionReason, '仅现场协调');
});

test('materials cannot be removed during acceptance to bypass required evidence', async () => {
  const f = fixture({ status: 'pending_accept' });
  await assert.rejects(f.service.deleteTaskAsset(executor, 531, 1), /不能删除验收资料/);
});

test('link creation cannot forge an uploaded file or store an invalid link', async () => {
  const f = fixture();
  f.service.assertCanWriteTaskProcess = async () => {};
  f.service.dailyUpdates.findOne = async () => ({ id: 1, taskId: 531 });
  const saved = [];
  f.service.assets.create = data => data;
  f.service.assets.save = async data => { saved.push(data); return { id: 1, ...data }; };
  for (const url of ['not-a-url', 'javascript:alert(1)', 'file:///secret']) {
    await assert.rejects(f.service.createTaskAsset(executor, 531, { title: '伪资料', dailyUpdateId: 1, url, filePath: '/etc/passwd' }), /HTTP\/HTTPS/);
  }
  assert.equal(saved.length, 0);
  const asset = await f.service.createTaskAsset(executor, 531, { title: '资料', dailyUpdateId: 1, url: 'https://example.com/doc', filePath: '/etc/passwd' });
  assert.equal(asset.filePath, null);
  assert.equal(asset.url, 'https://example.com/doc');
});


test('missing weeks block both submission and approval before any status, log or notification changes', async () => {
  for (const [status, target, actor] of [['doing', 'pending_accept', executor], ['doing', 'pending_accept', admin], ['pending_accept', 'done', acceptor]]) {
    const f = fixture({ status, materials: [{ taskId: 531, filePath: 'uploads/spec.pdf' }] });
    let missing = [{ weekStart: '2026-09-14', weekEnd: '2026-09-20' }];
    f.service.weeklyProgress.missingWeeksForTask = async id => { assert.equal(id, 531); return missing; };
    await assert.rejects(f.service.transition(actor, 531, target), error => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().code, 'WEEKLY_PROGRESS_MISSING');
      assert.deepEqual(error.getResponse().missingWeeks, missing);
      return true;
    });
    assert.equal(f.task.status, status);
    assert.equal(f.logs.length, 0);
    assert.equal(f.sent.length, 0);
    missing = [];
    await f.service.transition(actor, 531, target);
    assert.equal(f.task.status, target);
  }
});

test('weekly validation failure does not allow acceptance to proceed', async () => {
  const f = fixture({ materials: [{ taskId: 531, filePath: 'uploads/spec.pdf' }] });
  f.service.weeklyProgress.missingWeeksForTask = async () => { throw Error('数据库暂不可用'); };
  await assert.rejects(f.service.transition(executor, 531, 'pending_accept'), /数据库暂不可用/);
  assert.equal(f.task.status, 'doing');
  assert.equal(f.logs.length, 0);
  assert.equal(f.sent.length, 0);
});
