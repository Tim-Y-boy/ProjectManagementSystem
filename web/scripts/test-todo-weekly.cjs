const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/utils/todo-weekly.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(code, context);
const { mergeWeeklyTodos } = context.exports;
const notice = (id, taskId = '264', projectId = '32', weekStart = '2026-09-28') => ({
  id, taskId, projectId, weekStart, weekEnd: '2026-10-04', taskTitle: '测试21', projectName: '测试项目',
  desktopPath: `/tasks?taskId=${taskId}&workDate=${weekStart}`, mobilePath: `/mobile/tasks/${taskId}?workDate=${weekStart}`,
});

test('weekly reminders merge into the same project/task without inflating task count or replacing overdue data', () => {
  const groups = [{ projectId: 32, name: '测试项目', planLocked: true, tasks: [{ id: 264, status: 'doing', dueAt: '2026-08-31', title: '测试21' }] }];
  const result = mergeWeeklyTodos(groups, [notice('1'), notice('2', '264', '32', '2026-09-21'), notice('1')]);
  assert.equal(result.length, 1);
  assert.equal(result[0].tasks.length, 1);
  const task = result[0].tasks[0];
  assert.equal(task.status, 'doing');
  assert.equal(task.dueAt, '2026-08-31');
  assert.equal(task.weeklyNotices.length, 2);
  assert.equal(task.weeklyNotices[0].weekStart, '2026-09-21');
  assert.equal(task.weeklyNotices[0].desktopPath, '/tasks?taskId=264&workDate=2026-09-21');
  assert.equal(groups[0].tasks[0].weeklyNotices, undefined);
});

test('reminders for tasks absent from normal todos remain actionable without inventing status/deadline', () => {
  const result = mergeWeeklyTodos([], [notice('1'), notice('2', '265'), notice('3', '266', '33')]);
  assert.equal(result.length, 2);
  assert.equal(result[0].tasks.length, 2);
  assert.equal(result[0].tasks[0].weeklyOnly, true);
  assert.equal(result[0].tasks[0].status, undefined);
  assert.equal(result[0].tasks[0].dueAt, undefined);
  assert.equal(result[0].tasks[0].weeklyNotices[0].mobilePath, '/mobile/tasks/264?workDate=2026-09-28');
});

test('refresh after filling a week removes its reminder and reminder-only tasks disappear', () => {
  const normal = [{ projectId: 32, tasks: [{ id: 264, title: '测试21' }] }];
  assert.equal(mergeWeeklyTodos(normal, [])[0].tasks[0].weeklyNotices.length, 0);
  assert.equal(mergeWeeklyTodos([], []).length, 0);
});
