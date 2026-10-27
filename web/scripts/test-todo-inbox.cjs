const { test } = require('node:test');
const assert = require('node:assert/strict');
require('typescript');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const ctx = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/utils/todo-inbox.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, ctx);
const { buildInbox, inboxCounts, inboxFilter } = ctx.exports;

test('all approval kinds share the inbox and confirmation keeps its task detail link', () => {
  const rows = buildInbox({ confirm: [{ projectId: 1, name: '项目', tasks: [{ id: 8, title: '新任务' }] }], accept: [{ projectId: 1, tasks: [{ id: 9 }] }], pendingApprovals: [{ id: 10 }] }, [], [{ id: 11, kind: 'closure_review', payload: {} }, { id: 12, kind: 'reopen_review', payload: {} }], []);
  assert.equal(inboxCounts(rows).approve, 5);
  assert.equal(rows.find(r => r.key === 'confirm-8').approvalType, 'confirm');
  assert.equal(rows.find(r => r.key === 'confirm-8').path, '/tasks?projectId=1&taskId=8');
  assert.equal(rows.find(r => r.key === 'accept-9').approvalType, 'accept');
  assert.equal(rows.find(r => r.key === 'change-10').approvalType, 'change');
  assert.equal(rows.find(r => r.key === 'notice-11').approvalType, 'closure');
  assert.equal(rows.find(r => r.key === 'notice-12').approvalType, 'reopen');
});
test('project grouping reunites interleaved tasks, distinguishes equal names and preserves priority order', () => {
  const rows = [
    { key: 'a', projectId: 1, project: '同名项目', risk: 2 },
    { key: 'b', projectId: 2, project: '同名项目', risk: 2 },
    { key: 'c', projectId: '1', project: '同名项目', risk: 0 },
  ];
  const groups = ctx.exports.groupInboxProjects(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].rows.map(r => r.key).join(','), 'a,c');
  assert.equal(groups[1].rows[0].key, 'b');
  assert.equal(groups[0].overdue, 1);
  assert.equal(rows.length, 3);
});
test('all includes approvals, acceptance, execution and notices; projects and pending applications do not inflate count', () => {
  const rows = buildInbox({ pendingApprovals: [{ id: 9, projectName: '审批' }], accept: [{ projectId: 1, tasks: [{ id: 2 }] }] }, [{ projectId: 1, tasks: [{ id: 3, weeklyNotices: [{ id: 1 }, { id: 2 }] }] }], [{ id: 4, kind: 'closure_peer_review', payload: {} }, { id: 5, kind: 'closure_hr', payload: {} }, { id: 6, kind: 'closure_review', acknowledged_at: '2026-10-01', payload: {} }], [{ projectId: 7, state: 'pending' }, { projectId: 8, state: 'none' }]);
  assert.equal(inboxCounts(rows).all, 6);
  assert.equal(inboxCounts(rows).approve, 3);
  assert.equal(rows.find(r => r.key === 'accept-2').taskId, 2);
  assert.equal(inboxFilter('accept'), 'approve');
  assert.equal(inboxCounts(rows).todo, 2);
  assert.equal(inboxCounts(rows).inform, 1);
  assert.equal(rows[0].category, 'approve');
  assert.equal(rows.filter(r => r.key === 'task-3').length, 1);
  assert.equal(rows.find(r => r.key === 'change-9').path, '/plan-changes?changeId=9');
});
test('unknown query defaults to all and historical notice remains retrievable', () => {
  assert.equal(inboxFilter('invalid'), 'all');
  assert.equal(inboxFilter('approve'), 'approve');
  const rows = buildInbox({}, [], [{ id: 3, kind: 'closure_review', acknowledged_at: 'done', payload: {} }], []);
  assert.equal(rows[0].done, true);
  assert.equal(inboxCounts(rows).all, 0);
});
