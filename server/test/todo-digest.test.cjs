const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const service = Object.create(TasksService.prototype);
service.todayString = () => '2026-10-15';
service.systemUrl = path => `https://example.com${path}`;

test('task result and confirmation cards identify the exact task, not just its project', async () => {
  const svc = Object.create(TasksService.prototype);
  const cards = [];
  svc.projects = { findOne: async () => ({ name: '项目' }) };
  svc.getAssigneeIds = async () => [2];
  svc.getProjectOwnerIds = async () => [2];
  svc.userName = async () => '用户';
  svc.systemUrl = service.systemUrl;
  svc.buildNotifyCard = value => value;
  svc.feishuNotify = { sendCard: async (...args) => cards.push(args[2]), syncReviewCards: async () => {} };
  const task = { id: 12, projectId: 1, title: '任务' };
  await svc.notifyTaskAcceptanceResult(task, 3, true);
  await svc.notifyTaskAcceptanceResult(task, 3, false, '补充资料');
  await svc.notifyTaskPendingConfirm({ id: 1, name: '项目' }, task, 3);
  assert.equal(cards.length, 3);
  for (const card of cards.slice(0, 2)) assert.match(card.action.url, /\/tasks\?projectId=1&taskId=12/);
  assert.equal(cards[2].action.url, 'https://example.com/approvals?confirmId=12');
});

test('submitted task notification opens its approval in the inbox', async () => {
  const svc = Object.create(TasksService.prototype);
  svc.projects = { findOne: async () => ({ name: '项目' }) };
  svc.getAssigneeIds = async () => [2];
  svc.userName = async () => '提交人';
  svc.dailyUpdates = { find: async () => [] };
  svc.systemUrl = service.systemUrl;
  svc.buildNotifyCard = value => value;
  const cards = [];
  svc.feishuNotify = { sendCard: async (...args) => cards.push(args[2]) };
  await svc.notifyTaskSubmittedForAcceptance({ id: 12, projectId: 1, title: '任务' }, 3);
  assert.equal(cards[0].action.label, '去审批');
  assert.equal(cards[0].action.url, 'https://example.com/approvals?taskId=12');
});
test('approval-only digest opens approvals and links to the exact request', () => {
  const { card } = service.buildDailyDigestCard({ todo: [], accept: [], owned: [], approvals: [{ id: 17, projectName: '项目', itemCount: 1 }] }, { dueLimit: '2026-10-18' });
  assert.match(JSON.stringify(card), /approvals\?changeId=17/);
  assert.match(JSON.stringify(card), /\/approvals/);
  assert.match(JSON.stringify(card), /查看待我审批/);
});
test('mixed digest opens all; project risk alone opens project overview', () => {
  const approval = { id: 1, projectName: '项目', itemCount: 1 };
  const task = { projectId: 1, projectName: '项目', title: '任务', status: 'todo' };
  assert.match(JSON.stringify(service.buildDailyDigestCard({ todo: [], accept: [task], owned: [], approvals: [approval] }, {}).card), /\/approvals/);
  assert.match(JSON.stringify(service.buildDailyDigestCard({ todo: [task], accept: [], owned: [], approvals: [approval] }, {}).card), /my-todo\?tab=all/);
  assert.match(JSON.stringify(service.buildDailyDigestCard({ todo: [], accept: [], owned: [{ projectName: '项目', overdue: 1, dueSoon: 0 }], approvals: [] }, {}).card), /\/dashboard/);
});
test('digest recipients follow the current approval stage instead of all project managers', async () => {
  const svc = Object.create(TasksService.prototype);
  svc.getProjectOwnerIds = async () => [2, 3];
  svc.finalApproverIdsOf = async () => [8, 9];
  assert.deepEqual(await svc.dailyApprovalRecipients({ finalApproverId: 8, stage: 'owner' }, { id: 1 }, new Set([2, 8, 9, 10])), [2, 3]);
  assert.deepEqual(await svc.dailyApprovalRecipients({ finalApproverId: 8, stage: 'final' }, { id: 1 }, new Set([2, 8, 9, 10])), [8, 9]);
  assert.deepEqual(await svc.dailyApprovalRecipients({ finalApproverId: null }, { id: 1 }, new Set([2, 8])), [2, 8]);
});
