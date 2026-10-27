const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');

function fixture(status = 'done') {
  const task = { id: 531, projectId: 18, parentId: 444, title: '现场布局确认', status,
    creatorId: 219, assigneeId: '71', acceptorId: '16', dueAt: '2026-05-15', completedAt: new Date() };
  const events = [], sent = [];
  const service = Object.create(TasksService.prototype);
  service.weeklyProgress = { missingWeeksForTask: async () => [] };
  service.tasks = { findOne: async () => task, save: async (row) => { events.push('saved'); return row; } };
  service.projects = { findOne: async () => ({ id: 18, name: '包装车间自动化改造项目', ownerId: 99, status: 'active', planLocked: true }) };
  service.assignees = { find: async ({ where }) => (where.role === 'assignee' ? ['71', 219, '16'] : [16, '30', '219']).map(userId => ({ userId })) };
  service.isOwnerOf = async () => false;
  service.hasActiveChildren = async () => false;
  service.assertProjectPlanLocked = async () => {};
  service.assertCanWriteDept = () => {};
  service.userName = async () => '管理员';
  service.addLog = async () => events.push('logged');
  service.refreshParentStatus = async () => events.push('refreshed');
  service.systemUrl = (url) => `https://tracker.example${url}`;
  service.feishuNotify = { syncReviewCards: async () => {}, sendCard: async (...args) => { events.push('sent'); sent.push(args); } };
  return { service, task, sent, events };
}
const admin = { userId: 1, roles: ['admin'], deptId: 4, managedDeptIds: [] };

for (const [from, type, title, next] of [
  ['done', 'task_completed_reopened', '已完成任务退回进行中', '任务已回到进行中'],
  ['pending_accept', 'task_acceptance_rejected', '任务验收退回', '任务已回到进行中'],
  ['pending_confirm', 'task_confirmation_rejected', '任务确认退回', '恢复待办后再开始执行'],
]) {
  test(`${from} return notifies all task owners and executors once after saving`, async () => {
    const f = fixture(from);
    if (from === 'pending_confirm') await f.service.rejectTask(admin, 531, '请核对设备参数');
    else await f.service.transition(admin, 531, 'doing', '请核对设备参数');
    assert.deepEqual(f.sent.map(row => row[1]).sort((a, b) => a - b), [16, 30, 71, 219]);
    assert.deepEqual(f.events.slice(0, 2), ['saved', 'logged']);
    assert.equal(f.events.at(-1), 'refreshed');
    for (const [actualType, recipient, card, fallback, refs] of f.sent) {
      assert.equal(actualType, type);
      assert.match(card.header.title.content, new RegExp(title));
      for (const text of ['包装车间自动化改造项目', '现场布局确认', '管理员', '请核对设备参数', next]) {
        assert.ok(JSON.stringify(card).includes(text), text);
        assert.ok(fallback.includes(text), text);
      }
      assert.ok(JSON.stringify(card).includes(from === 'done' ? '/tasks?projectId=18&taskId=531' : `/approvals?${from === 'pending_confirm' ? 'confirmId' : 'taskId'}=531&at=`));
      assert.deepEqual(refs, { projectId: 18, taskId: 531 });
      assert.notEqual(recipient, 99); // unrelated project owner is not a task owner
    }
  });
}

test('legacy single-person fields work and recipient who operated is still notified', async () => {
  const f = fixture();
  f.service.assignees.find = async () => [];
  f.task.acceptorId = '1';
  await f.service.transition(admin, 531, 'doing', '补充资料');
  assert.deepEqual(f.sent.map(row => row[1]), [71, 1]);
});

test('no assigned recipients does not invent a recipient', async () => {
  const f = fixture();
  f.service.assignees.find = async () => [];
  f.task.acceptorId = null;
  f.task.assigneeId = null;
  await f.service.transition(admin, 531, 'doing', '补充资料');
  assert.equal(f.sent.length, 0);
  assert.equal(f.task.status, 'doing');
});

test('failed return validation sends no notification', async () => {
  const f = fixture();
  await assert.rejects(f.service.transition(admin, 531, 'doing', ' '), /退回原因/);
  assert.equal(f.sent.length, 0);
  assert.equal(f.task.status, 'done');
});

test('acceptance approval keeps its original executor-only recipients', async () => {
  const f = fixture('pending_accept');
  await f.service.transition(admin, 531, 'done');
  assert.deepEqual(f.sent.map(row => row[1]).sort((a, b) => a - b), [16, 71, 219]);
  assert.ok(f.sent.every(row => row[0] === 'task_acceptance_approved'));
});

test('normal task start sends no return notifications', async () => {
  const f = fixture('todo');
  await f.service.transition(admin, 531, 'doing');
  assert.equal(f.sent.length, 0);
});
