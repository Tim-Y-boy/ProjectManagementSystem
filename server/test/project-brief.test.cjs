// Run from server: node -r ts-node/register/transpile-only --test test/project-brief.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TasksService } = require('../src/modules/tasks/tasks.service');

const today = '2026-09-16';
const service = () => Object.create(TasksService.prototype);
const task = (id, title, status, dueAt = null, parentId = null) => ({
  id, title, status, dueAt, parentId, projectId: 1, sortOrder: Number(id),
});
const summary = (tasks) => service().projectBriefTaskSummary(tasks, today);

test('current nodes and next deadline come from unfinished leaves, not parent stages or completed tasks', () => {
  const tasks = [
    task('1', '实施阶段', 'doing', '2026-09-16'),
    task('2', '设备安装', 'doing', '2026-09-20', 1),
    task('3', '接口联调', 'todo', '2026-09-18', '1'),
    task('4', '历史完成', 'done', '2026-09-16', '1'),
    task('5', '已取消任务', 'cancelled', '2026-09-16', '1'),
  ];
  assert.equal(summary(tasks), '节点：设备安装｜最近到期：2026-09-18（接口联调）');
});

test('today takes priority over future deadlines while existing overdue items stay in the risk section', () => {
  assert.equal(summary([
    task(1, '历史待办', 'todo', '2026-09-01'),
    task(2, '设备安装', 'doing', '2026-09-20'),
    task(3, '接口联调', 'doing', today),
  ]), '节点：接口联调、设备安装｜今日到期：2026-09-16（接口联调）');
});

test('overdue-only deadlines are explicitly labelled and rejected tasks remain unfinished', () => {
  assert.equal(summary([
    task(1, '现场确认', 'rejected', '2026-09-10'),
    task(2, '采购', 'todo', '2026-09-12'),
  ]), '暂无进行中节点（有退回任务）｜最早逾期：2026-09-10（现场确认）');
});

test('waiting acceptance, missing dates, completed and empty projects have accurate text', () => {
  assert.equal(summary([task(1, '联调验收', 'pending_accept')]), '待验收：联调验收｜未完成任务未设截止日期');
  assert.equal(summary([task(1, '设备采购', 'todo')]), '暂无进行中节点｜未完成任务未设截止日期');
  assert.equal(summary([task(1, '设备采购', 'done')]), '任务已全部完成');
  assert.equal(summary([task(1, '已取消', 'cancelled')]), '暂无任务');
  assert.equal(summary([]), '暂无任务');
});

test('parallel nodes are capped at two with total count and long names are shortened', () => {
  const text = summary([
    task(3, '第三项', 'doing'),
    task(1, '第一项', 'doing'),
    task(2, '很长的任务名称'.repeat(5), 'doing'),
  ]);
  assert.match(text, /^节点：第一项、很长的任务名称/);
  assert.match(text, /…等3项｜/);
  assert.doesNotMatch(text, /第三项/);
});

test('aggregation carries the task summary into rich text and plain text, with and without mentions', async () => {
  const s = service();
  s.todayString = () => today;
  s.projects = { find: async () => [
    { id: '1', name: 'MES项目', planLocked: true },
    { id: '2', name: '空项目', planLocked: false },
  ] };
  s.tasks = { find: async () => [task(1, '接口联调', 'doing', '2026-09-18')] };
  s.projectOwnerIdsMap = async () => new Map([[1, [16]], [2, []]]);
  s.users = { find: async () => [{ id: '16', name: '负责人', openId: null }] };
  s.systemUrl = (path) => `https://example.test${path}`;
  const rows = await s.projectBriefRows();
  assert.equal(rows[0].taskSummary, '节点：接口联调｜最近到期：2026-09-18（接口联调）');
  assert.equal(rows[1].taskSummary, '暂无任务');
  for (const withAt of [true, false]) {
    const post = s.buildGroupBriefPost(rows, today, withAt, null);
    assert.ok(post.content[1].some((segment) => segment.tag === 'a'), 'first project directly follows heading');
    assert.ok(post.content[2].some((segment) => segment.tag === 'a'), 'projects have no empty row between them');
    assert.ok(post.fallback.split('\n')[1].trim());
    assert.ok(post.fallback.split('\n')[2].trim());
    const text = post.content.flat().map((segment) => segment.text || '').join('');
    assert.ok(text.includes(rows[0].taskSummary));
    assert.ok(post.fallback.includes(rows[0].taskSummary));
    assert.ok(post.content.flat().some((segment) => segment.tag === 'a' && segment.href.endsWith('/projects/1')));
    assert.doesNotMatch(post.fallback, /undefined|null/);
  }
});
test('completed project still appears in closure reminders without any overdue task', () => {
  const s = service(); s.systemUrl = (p) => `https://example.test${p}`;
  const rows = [{ id: 1, name: '已完成项目', pct: 100, hasDueSoon: false, hasOverdue: false, overdueCount: 0, planLocked: true, overdueTasks: [], owners: [], taskSummary: '任务已全部完成' }];
  for (const mentions of [true, false]) {
    const post = s.buildGroupBriefPost(rows, today, mentions, null, ['【待申请结项】已完成项目：全部验收完成，已等待3天']);
    assert.match(post.fallback, /关键提醒 · 项目结项/); assert.match(post.fallback, /已等待3天/);
    assert.ok(post.content.flat().some((s) => (s.text || '').includes('待申请结项')));
  }
});
