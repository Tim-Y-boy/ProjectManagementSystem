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

test('AI receives every overdue task and all progress, with temporal safeguards and concise output instructions', async () => {
  const { config } = require('../src/config/config');
  const axios = require('axios');
  const saved = { ...config.llm };
  const originalPost = axios.default.post;
  const queries = [];
  const s = service();
  s.dailyUpdates = { find: async (query) => {
    queries.push(query);
    return [
      { taskId: '1', workDate: '2026-09-01', createdAt: new Date('2026-09-16T01:00:00Z'), content: '接口存在问题' },
      { taskId: '1', workDate: '2026-09-02', content: '第二次推进' },
      { taskId: '1', workDate: '2026-09-03', content: '第三次推进' },
      { taskId: '1', workDate: '2026-09-15', createdAt: new Date('2026-09-15T01:00:00Z'), content: '问题已解决，等待验收' },
      { taskId: '5', workDate: '2026-09-16', content: '第五项任务的完整进展' },
    ];
  } };
  try {
    Object.assign(config.llm, { enabled: true, apiKey: 'test', briefThinking: false });
    axios.default.post = async (_url, body) => {
      const system = body.messages[0].content;
      const prompt = body.messages[1].content;
      assert.ok(prompt.indexOf('接口存在问题') < prompt.indexOf('问题已解决'));
      assert.match(prompt, /工作日期.*2026-09-01.*录入时间.*2026-09-16/);
      assert.match(prompt, /暂无可用关键进展/);
      for (let id = 1; id <= 5; id++) assert.ok(prompt.includes(`任务${id}`));
      for (const content of ['接口存在问题', '第二次推进', '第三次推进', '问题已解决', '第五项任务的完整进展']) assert.ok(prompt.includes(content));
      assert.match(system, /全部延期任务及每项任务的全部关键进展/);
      assert.match(system, /每项目不超过120字/);
      assert.match(system, /不代表停工或没有开展工作/);
      assert.match(system, /不得直接当作当前仍存在的问题/);
      assert.match(system, /不得将近期补填的历史记录视为近期进展/);
      return { data: { choices: [{ message: { content: '测试分析' } }] } };
    };
    assert.equal(await s.llmBriefNarrative([{
      name: '项目', pct: 75, planLocked: true, overdueCount: 5, owners: [],
      overdueTasks: [1, 2, 3, 4, 5].map(id => ({ id, title: `任务${id}`, days: 3, dueAt: '2026-09-13' })),
    }], today), '测试分析');
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].where.taskId.value, [1, 2, 3, 4, 5]);
    assert.equal(queries[0].take, undefined);
    assert.equal(queries[0].where.workDate, undefined);
    assert.equal(queries[0].order.workDate, 'ASC');
  } finally {
    Object.assign(config.llm, saved);
    axios.default.post = originalPost;
  }
});

test('project metrics preserve every overdue leaf beyond the previous four-task limit', () => {
  const s = service();
  const metrics = s.projectTreeMetrics([
    ...Array.from({ length: 6 }, (_, i) => task(i + 1, `延期任务${i + 1}`, 'doing', '2026-09-01')),
    task(7, '未到期', 'doing', '2026-09-20'),
    task(8, '已完成', 'done', '2026-09-01'),
  ], today);
  assert.equal(metrics.overdueCount, 6);
  assert.deepEqual(metrics.overdueTasks.map(t => t.id), [1, 2, 3, 4, 5, 6]);
});

test('current nodes and next deadline come from unfinished leaves, not parent stages or completed tasks', () => {
  const tasks = [
    task('1', '实施阶段', 'doing', '2026-09-16'),
    task('2', '设备安装', 'doing', '2026-09-20', 1),
    task('3', '接口联调', 'todo', '2026-09-18', '1'),
    task('4', '历史完成', 'done', '2026-09-16', '1'),
    task('5', '已取消任务', 'cancelled', '2026-09-16', '1'),
  ];
  assert.equal(summary(tasks), '节点：设备安装｜最近到期：2026-09-20（设备安装）');
});

test('oldest overdue unfinished task takes priority over parallel current deadlines', () => {
  assert.equal(summary([
    task(1, '历史待办', 'todo', '2026-09-01'),
    task(2, '设备安装', 'doing', '2026-09-20'),
    task(3, '接口联调', 'doing', today),
  ]), '节点：接口联调、设备安装｜最早逾期：2026-09-01（历史待办）');
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
