const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');

test('managed inbox returns only risk leaves from owned projects with executor and dates', async () => {
  const svc = Object.create(TasksService.prototype);
  svc.todayString = () => '2026-11-03';
  svc.listProjects = async () => [{ id: 1, name: '本人项目', ownerIds: ['9'] }, { id: 2, name: '其他项目', ownerIds: [10] }];
  svc.listPlanChanges = async () => [];
  svc.pendingConfirmationTasks = async () => [];
  svc.projects = { find: async () => [{ id: 1, name: '本人项目' }] };
  const tasks = [
    { id: 1, projectId: 1, title: '延期', status: 'doing', startAt: '2026-10-01', dueAt: '2026-11-02', assigneeId: 3 },
    { id: 2, projectId: 1, title: '临期', status: 'todo', dueAt: '2026-11-06' },
    { id: 3, projectId: 1, title: '远期', status: 'todo', dueAt: '2026-12-01' },
    { id: 4, projectId: 1, title: '已完成', status: 'done', dueAt: '2026-11-01' },
  ];
  let queryCount = 0;
  svc.tasks = { createQueryBuilder() {
    const index = queryCount++;
    const qb = { where(sql, params) { if (index === 2) assert.deepEqual(params.ids, [1]); return qb; }, andWhere() { return qb; }, orderBy() { return qb; }, addOrderBy() { return qb; }, getMany: async () => index === 2 ? tasks : [] };
    return qb;
  } };
  svc.getAssigneeIds = async () => [3];
  svc.userName = async () => '执行人';
  const result = await svc.myTodoOverview({ userId: 9 });
  assert.deepEqual(result.ownedTasks[0].tasks.map(t => t.id), [1, 2]);
  assert.equal(result.ownedTasks[0].tasks[0].assignees, '执行人');
  assert.equal(result.ownedTasks[0].tasks[0].inboxRisk, 2);
  assert.equal(result.ownedTasks[0].tasks[1].inboxRisk, 1);
  assert.equal(result.ownedTasks[0].tasks[0].startAt, '2026-10-01');
});
