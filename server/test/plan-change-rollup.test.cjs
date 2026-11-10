const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');

function fixture(items, remainingStatus = 'done') {
  const rows = [
    { id: 1, projectId: 1, parentId: null, status: 'doing' },
    { id: 2, projectId: 1, parentId: 1, status: 'doing' },
    { id: 3, projectId: 1, parentId: 2, status: remainingStatus },
    { id: 4, projectId: 1, parentId: 2, status: 'todo' },
  ];
  const logs = [];
  const s = Object.create(TasksService.prototype);
  const change = { id: 10, projectId: 1, status: 'pending', finalApproverId: null };
  s.planChanges = { findOne: async () => change, save: async x => x };
  s.planChangeItems = { find: async () => items };
  s.projects = { findOne: async () => ({ id: 1, name: '项目', status: 'active' }) };
  s.tasks = {
    findOne: async ({ where }) => rows.find(t => t.id === where.id),
    find: async ({ where }) => where.parentId != null
      ? rows.filter(t => t.parentId === where.parentId && t.status !== 'cancelled')
      : rows.filter(t => where.id.value.includes(t.id)),
    create: x => x,
    save: async x => { if (!x.id) { x.id = rows.length + 1; rows.push(x); } return x; },
  };
  s.canManageProject = async () => true;
  s.descendantTaskIds = async id => [id];
  s.syncParentPeopleFromChildren = async () => {};
  s.addLog = async (task, user, action, payload, from, to) => logs.push({ id: task.id, action, from, to });
  s.buildPlanChangeSummary = async () => ({ cardRows: [], plainLines: [] });
  s.userName = async () => '测试用户';
  s.changeRowsToTasks = () => [];
  s.buildNotifyCard = () => ({});
  s.feishuNotify = { syncReviewCards: async () => {}, sendCard: async () => {} };
  s.getPlanChange = async () => change;
  return { s, rows, logs };
}
const deletion = { changeType: 'delete', taskId: 4, before: {}, after: {} };

test('approved deletion rolls up completed remaining children through all ancestors', async () => {
  const { s, rows, logs } = fixture([deletion]);
  await s.approvePlanChange({ userId: 9 }, 10);
  assert.equal(rows[3].status, 'cancelled');
  assert.equal(rows[1].status, 'done');
  assert.equal(rows[0].status, 'done');
  assert.ok(rows[1].completedAt instanceof Date);
  assert.deepEqual(logs.filter(l => l.action === 'auto_rollup').map(l => l.id), [2, 1]);
});

test('remaining incomplete child keeps parent in progress', async () => {
  const { s, rows } = fixture([deletion], 'doing');
  await s.approvePlanChange({ userId: 9 }, 10);
  assert.equal(rows[1].status, 'doing');
});

test('batch deletion and addition rolls up only after all changes, avoiding false completion', async () => {
  const { s, rows, logs } = fixture([deletion, { changeType: 'add', taskId: 2, after: { title: '新增待办' } }]);
  await s.approvePlanChange({ userId: 9 }, 10);
  assert.equal(rows[1].status, 'doing');
  assert.ok(!logs.some(l => l.action === 'auto_rollup' && l.to === 'done'));
});

test('adding a child reopens a completed parent and clears completion time', async () => {
  const { s, rows } = fixture([{ changeType: 'add', taskId: 2, after: { title: '新范围' } }]);
  rows[0].status = rows[1].status = rows[3].status = 'done';
  rows[1].completedAt = new Date();
  await s.approvePlanChange({ userId: 9 }, 10);
  assert.equal(rows[1].status, 'doing');
  assert.equal(rows[0].status, 'doing');
  assert.equal(rows[1].completedAt, null);
});
