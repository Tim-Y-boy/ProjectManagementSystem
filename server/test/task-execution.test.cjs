// Run from server: node -r ts-node/register/transpile-only --test test/task-execution.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');

const member = (userId) => ({ userId, roles: ['member'], deptId: 99, managedDeptIds: [] });

function fixture({ status = 'todo', locked = true, ownerId = '16', owners = [], progress = 0, children = 0, projectStatus = 'active', closureState = 'none' } = {}) {
  const task = {
    id: 531, projectId: 18, parentId: 444, title: '现场布局确认', status,
    creatorId: '219', assigneeId: null, acceptorId: null,
    completedAt: new Date('2026-09-10T02:06:22Z'),
  };
  const logs = [];
  const refreshed = [];
  const updates = [];
  const service = Object.create(TasksService.prototype);
  service.weeklyProgress = { missingWeeksForTask: async () => [] };
  service.tasks = { findOne: async () => task, count: async () => children, save: async (row) => row };
  service.projects = { findOne: async () => ({ id: 18, ownerId, deptId: 4, planLocked: locked, status: projectStatus, closureState }) };
  service.departmentsRepo = { findOne: async () => ({ name: '总经办', headUserId: '50' }) };
  service.projectOwners = { count: async ({ where }) => Number(owners.map(String).includes(String(where.userId))) };
  service.assignees = { find: async ({ where }) => (where.role === 'assignee' ? ['71', '219'] : ['30']).map(userId => ({ userId })) };
  service.dailyUpdates = {
    count: async () => progress,
    create: (row) => row,
    save: async (row) => { updates.push(row); return { ...row, id: 1 }; },
  };
  service.assets = { find: async () => [{ id: 1, taskId: 531, url: 'https://example.com/task-material' }] };
  service.addLog = async (...args) => logs.push(args);
  service.refreshParentStatus = async (...args) => refreshed.push(args);
  service.notifyTaskSubmittedForAcceptance = async () => {};
  service.notifyTaskAcceptanceResult = async () => {};
  return { service, task, logs, refreshed, updates };
}

test('completed-task detail capability is disabled throughout closure freeze', async () => {
  const admin = { ...member(1), roles: ['admin'] };
  for (const closureState of ['none', 'pending', 'closed']) {
    const f = fixture({ status: 'done', closureState });
    f.service.tasks.find = async () => [];
    f.service.logs = { find: async () => [] };
    f.service.withLogOperators = async rows => rows;
    f.service.getProjectOwnerIds = async () => [16];
    const detail = await f.service.getTask(admin, 531);
    assert.equal(detail.canReopenCompleted, closureState === 'none');
    if (closureState !== 'none') {
      await assert.rejects(f.service.transition(admin, 531, 'doing', '纠正'), /结项/);
      assert.equal(f.task.status, 'done');
      assert.equal(f.logs.length, 0);
    }
  }
});

test('task list also disables completed return capability for frozen projects', async () => {
  for (const closureState of ['none', 'pending', 'closed']) {
    const f = fixture({ status: 'done', closureState });
    const qb = { getCount: async () => 1, getMany: async () => [f.task] };
    for (const method of ['andWhere', 'orderBy', 'addOrderBy', 'skip', 'take']) qb[method] = () => qb;
    f.service.tasks.createQueryBuilder = () => qb;
    f.service.tasks.find = async () => [];
    f.service.projects.find = async () => [await f.service.projects.findOne()];
    f.service.assignees.find = async () => [];
    f.service.exemptedTaskIds = async () => new Set();
    const result = await f.service.listTasks({ ...member(1), roles: ['admin'] }, {});
    assert.equal(result.list[0].canReopenCompleted, closureState === 'none');
  }
});

test('project owner can start a task created and assigned to others', async () => {
  const f = fixture();
  await f.service.transition(member(16), 531, 'doing');
  assert.equal(f.task.status, 'doing');
});

test('additional project owner can start via the owner association table', async () => {
  const f = fixture({ ownerId: '17', owners: ['16'] });
  await f.service.transition(member(16), 531, 'doing');
  assert.equal(f.task.status, 'doing');
});

test('string database IDs match numeric executor and creator IDs', async () => {
  for (const uid of [71, 219]) {
    const f = fixture();
    await f.service.transition(member(uid), 531, 'doing');
    assert.equal(f.task.status, 'doing');
  }
});

test('unrelated members cannot start a task', async () => {
  for (const uid of [88, 99]) {
    const f = fixture();
    await assert.rejects(f.service.transition(member(uid), 531, 'doing'), { status: 403 });
    assert.equal(f.task.status, 'todo');
    assert.equal(f.logs.length, 0);
  }
});

test('task acceptor can start, record progress and submit when the project has a different owner', async () => {
  for (const legacy of [false, true]) {
    const f = fixture({ progress: 1 });
    if (legacy) {
      f.task.acceptorId = '30';
      f.service.assignees.find = async () => [];
    }
    await f.service.transition(member(30), 531, 'doing');
    assert.equal(f.task.status, 'doing');
    const row = await f.service.createDailyUpdate(member(30), 531, { workDate: '2026-09-14', content: '负责人录入进展', noMaterialReason: '仅现场协调' });
    assert.equal(row.userId, 30);
    await f.service.transition(member(30), 531, 'pending_accept');
    assert.equal(f.task.status, 'pending_accept');
  }
});

test('restore is allowed for executors, project owner, acceptor, admin and leader', async () => {
  for (const actor of [member(71), member(219), member(16), member(30), { ...member(1), roles: ['admin'] }, { ...member(2), roles: ['leader'] }]) {
    const f = fixture({ status: 'rejected', progress: 2 });
    await f.service.transition(actor, 531, 'todo', '恢复待办');
    assert.equal(f.task.status, 'todo');
    assert.equal(f.task.completedAt, null);
    assert.equal(await f.service.dailyUpdates.count(), 2);
    assert.deepEqual(f.logs[0].slice(1), [actor.userId, 'transition', { comment: '恢复待办' }, 'rejected', 'todo']);
    assert.deepEqual(f.refreshed, [[444, actor.userId]]);
  }
});

test('creator-only and unrelated members cannot restore tasks', async () => {
  for (const uid of [88, 99]) {
    const f = fixture({ status: 'rejected' });
    f.task.creatorId = '88';
    await assert.rejects(f.service.transition(member(uid), 531, 'todo'), { status: 403 });
    assert.equal(f.task.status, 'rejected');
  }
});

test('executor can restore and start their own task, without automatic completion', async () => {
  const f = fixture({ status: 'rejected' });
  await f.service.transition(member(71), 531, 'todo');
  await f.service.transition(member(71), 531, 'doing');
  assert.equal(f.task.status, 'doing');
  assert.equal(f.task.completedAt, null);
});

test('project owner can record progress across departments under their own identity', async () => {
  const f = fixture({ status: 'doing', ownerId: '17', owners: ['16'] });
  const row = await f.service.createDailyUpdate(member(16), 531, { workDate: '2026-09-14', content: '已确认现场布局', noMaterialReason: '现场口头确认' });
  assert.equal(row.userId, 16);
  assert.equal(row.content, '已确认现场布局');
  assert.equal(f.logs[0][2], 'daily_update');
});

test('unrelated member cannot record progress across departments', async () => {
  const f = fixture({ status: 'doing' });
  await assert.rejects(f.service.createDailyUpdate(member(88), 531, { workDate: '2026-09-14', content: '进展' }), { status: 403 });
  assert.equal(f.updates.length, 0);
});

test('project owner can edit their own progress when database IDs are strings', async () => {
  const f = fixture({ status: 'doing' });
  await f.service.assertCanModifyDailyUpdate(member(16), f.task, { userId: '16', status: 'normal' });
});

test('project owner can submit with progress but cannot bypass the progress requirement', async () => {
  const f = fixture({ status: 'doing', progress: 1 });
  await f.service.transition(member(16), 531, 'pending_accept');
  assert.equal(f.task.status, 'pending_accept');
  const empty = fixture({ status: 'doing' });
  await assert.rejects(empty.service.transition(member(16), 531, 'pending_accept'), /尚未提交关键进展/);
});

test('execution permission does not grant acceptance permission', async () => {
  for (const uid of [16, 71, 219]) {
    const f = fixture({ status: 'pending_accept' });
    await assert.rejects(f.service.transition(member(uid), 531, 'done'), { status: 403 });
  }
  const f = fixture({ status: 'pending_accept' });
  await f.service.transition(member(30), 531, 'done');
  assert.equal(f.task.status, 'done');
});

test('project lock, parent rollup and undo-start restrictions still apply', async () => {
  await assert.rejects(fixture({ locked: false }).service.transition(member(16), 531, 'doing'), /未定稿/);
  await assert.rejects(fixture({ status: 'rejected', children: 1 }).service.transition(member(16), 531, 'todo'), /父任务/);
  await assert.rejects(fixture({ status: 'doing', progress: 1 }).service.transition(member(16), 531, 'todo'), /不能撤销/);
  await assert.rejects(fixture({ status: 'done' }).service.transition({ ...member(1), roles: ['admin'] }, 531, 'todo'), /不允许/);
});

test('project metrics count rejected overdue leaves without counting their parent or completed tasks', () => {
  const f = fixture();
  const tasks = [
    { id: 444, parentId: null, status: 'doing', title: '筹备阶段', dueAt: '2026-08-12' },
    { id: 531, parentId: 444, status: 'rejected', title: '现场布局确认', dueAt: '2026-05-15' },
    { id: 532, parentId: 444, status: 'rejected', title: '组织供应商沟通设计', dueAt: '2026-07-31' },
    ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, parentId: 444, status: 'done', dueAt: '2026-07-31' })),
  ];
  const metrics = f.service.projectTreeMetrics(tasks, '2026-09-14');
  assert.equal(metrics.overdueCount, 2);
  assert.equal(metrics.hasOverdue, true);
  assert.equal(metrics.pct, 71);
  assert.equal(metrics.overdueTasks[0].days, 122);
  assert.equal(f.service.taskRiskType(tasks[1], '2026-09-14', '2026-09-17'), 'overdue');
  tasks[1].status = 'cancelled';
  assert.equal(f.service.projectTreeMetrics(tasks, '2026-09-14').overdueCount, 1);
});

test('only admin and configured general office head can reopen completed tasks', async () => {
  const previous = process.env.PLAN_FINAL_APPROVER_USER_ID;
  delete process.env.PLAN_FINAL_APPROVER_USER_ID;
  try {
    for (const actor of [{ ...member(1), roles: ['admin'] }, member(50)]) {
      const f = fixture({ status: 'done', progress: 2 });
      const completedAt = f.task.completedAt;
      await f.service.transition(actor, 531, 'doing', '  测试验收需要纠正  ');
      assert.equal(f.task.status, 'doing');
      assert.equal(f.task.completedAt, null);
      assert.equal(await f.service.dailyUpdates.count(), 2);
      assert.deepEqual(f.logs[0].slice(1), [actor.userId, 'transition', { comment: '测试验收需要纠正', previousCompletedAt: completedAt }, 'done', 'doing']);
      assert.deepEqual(f.refreshed, [[444, actor.userId]]);
    }
    for (const actor of [member(16), member(30), member(71), member(219), { ...member(2), roles: ['leader'] }, { ...member(3), roles: ['dept_head'] }]) {
      const f = fixture({ status: 'done' });
      await assert.rejects(f.service.transition(actor, 531, 'doing', '纠正'), { status: 403 });
      assert.equal(f.task.status, 'done');
      assert.equal(f.logs.length, 0);
    }
  } finally {
    if (previous === undefined) delete process.env.PLAN_FINAL_APPROVER_USER_ID;
    else process.env.PLAN_FINAL_APPROVER_USER_ID = previous;
  }
});

test('reopening requires reason, finalized active project and leaf task; later acceptance gets a new completion time', async () => {
  const admin = { ...member(1), roles: ['admin'] };
  for (const [options, reason, pattern] of [
    [{ status: 'done' }, '  ', /退回原因/],
    [{ status: 'done', projectStatus: 'archived' }, '纠正', /已归档/],
    [{ status: 'done', locked: false }, '纠正', /未定稿/],
    [{ status: 'done', children: 1 }, '纠正', /父任务/],
  ]) {
    const f = fixture(options);
    await assert.rejects(f.service.transition(admin, 531, 'doing', reason), pattern);
    assert.equal(f.task.status, 'done');
    assert.equal(f.logs.length, 0);
  }
  const f = fixture({ status: 'done', progress: 1 });
  const previous = f.task.completedAt;
  await f.service.transition(admin, 531, 'doing', '返工');
  await f.service.transition(member(71), 531, 'pending_accept');
  await f.service.transition(member(30), 531, 'done');
  assert.equal(f.task.status, 'done');
  assert.notEqual(f.task.completedAt, previous);
});

test('local final-approver override is honored without granting other leaders permission', async () => {
  const previous = process.env.PLAN_FINAL_APPROVER_USER_ID;
  try {
    process.env.PLAN_FINAL_APPROVER_USER_ID = '459';
    const f = fixture();
    assert.equal(await f.service.canReopenCompletedTask(member(459)), true);
    assert.equal(await f.service.canReopenCompletedTask(member(50)), false);
    process.env.PLAN_FINAL_APPROVER_USER_ID = 'invalid';
    assert.equal(await f.service.canReopenCompletedTask(member(50)), false);
  } finally {
    if (previous === undefined) delete process.env.PLAN_FINAL_APPROVER_USER_ID;
    else process.env.PLAN_FINAL_APPROVER_USER_ID = previous;
  }
});

function withDeleteTransaction(f) {
  f.service.tasks.manager = { transaction: callback => callback({ getRepository: entity => ({
    Task: f.service.tasks, TaskDailyUpdate: f.service.dailyUpdates, TaskAsset: f.service.assets,
    TaskLog: { create: row => row, save: async row => f.logs.push([f.task, row.operatorId, row.action, row.payload]) },
  }[entity.name]) }) };
}

test('administrator can delete ordinary completed-task progress without reopening or deleting assets', async () => {
  const f = fixture({ status: 'done' });
  const row = { id: 123, taskId: 531, userId: '1', status: 'normal', workDate: '2026-09-21', content: '测试' };
  const removed = [], assets = [];
  f.service.dailyUpdates.findOne = async () => row;
  f.service.dailyUpdates.delete = async (id) => removed.push(id);
  f.service.assets = { find: async () => [{ id: 9, taskId: 531, dailyUpdateId: 123, linkedDailyUpdateIds: [124] }], save: async row => assets.push(row) };
  withDeleteTransaction(f);
  const completed = f.task.completedAt;
  await f.service.deleteDailyUpdate({ ...member(1), roles: ['admin'] }, 531, 123);
  assert.deepEqual(removed, [123]);
  assert.deepEqual(assets, [{ id: 9, taskId: 531, dailyUpdateId: null, linkedDailyUpdateIds: [124] }]);
  assert.equal(f.task.status, 'done');
  assert.equal(f.task.completedAt, completed);
  assert.equal(f.logs[0][2], 'daily_update_delete');
  assert.deepEqual(f.logs[0][3].deletedUpdate, row);
});

test('completed progress deletion does not open editing, exempted records, archived projects or ordinary-user deletion', async () => {
  const admin = { ...member(1), roles: ['admin'] };
  const row = { id: 123, taskId: 531, userId: '1', status: 'normal' };
  const f = fixture({ status: 'done' });
  await assert.rejects(f.service.assertCanModifyDailyUpdate(admin, f.task, row), /不可编辑或删除/);
  await assert.rejects(f.service.assertCanModifyDailyUpdate(member(1), f.task, row, true), /不可编辑或删除/);
  await assert.rejects(f.service.assertCanModifyDailyUpdate(admin, f.task, { ...row, status: 'exempted' }, true), /合理补填/);
  const archived = fixture({ status: 'done', projectStatus: 'archived' });
  archived.service.dailyUpdates.findOne = async () => row;
  withDeleteTransaction(archived);
  await assert.rejects(archived.service.deleteDailyUpdate(admin, 531, 123), /已归档/);
  assert.equal(archived.logs.length, 0);
});
