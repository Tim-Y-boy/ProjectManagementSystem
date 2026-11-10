const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const ctx = { exports: {}, Intl, Date };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/utils/todo-inbox.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText, ctx);
const { buildInbox, inboxCounts } = ctx.exports;
const build = tasks => buildInbox({}, [{ projectId: 1, name: '项目', tasks }], [], [], '2026-11-03');

test('project weekly todo retains overdue unsubmitted reports', () => {
  const rows=buildInbox({projectWeeklyReports:[
    {projectId:1,projectName:'项目',weekStart:'2026-11-02',weekEnd:'2026-11-08',status:'missing',overdue:false},
    {projectId:1,projectName:'项目',weekStart:'2026-10-26',weekEnd:'2026-11-01',status:'missing',overdue:true},
    {projectId:2,projectName:'已交',weekStart:'2026-11-02',weekEnd:'2026-11-08',status:'submitted'},
  ]},[],[],[],'2026-11-06');
  assert.equal(rows.length,2);
  assert.equal(inboxCounts(rows).all,2);
  assert.equal(inboxCounts(rows).owned,2);
  assert.ok(rows.every(row=>row.path.includes('/daily-report?tab=weekly&projectId=1&weekStart=')));
  assert.ok(rows.every(row=>row.mobilePath.startsWith('/mobile/daily-report?tab=weekly')));
  assert.ok(rows.every(row=>!row.description.includes('草稿')));
  assert.ok(rows.every(row=>!row.title.includes('逾期')));
});
test('five day boundary and unscheduled tasks stay quiet until actionable', () => {
  const rows = build([
    { id: 1, status: 'todo', startAt: '2026-11-08' },
    { id: 2, status: 'todo', startAt: '2026-11-09' },
    { id: 3, status: 'todo' },
    { id: 4, status: 'todo', startAt: '2026-11-01' },
  ]);
  assert.equal(rows.find(r => r.key === 'task-1').category, 'todo');
  assert.equal(rows.find(r => r.key === 'task-2').category, 'future');
  assert.equal(rows.find(r => r.key === 'task-3').category, 'future');
  assert.equal(rows.find(r => r.key === 'task-4').category, 'todo');
  assert.equal(inboxCounts(rows).all, 2);
});
test('doing, risk and missing progress override distant starts', () => {
  const rows = build([
    { id: 1, status: 'doing', startAt: '2026-12-01' },
    { id: 2, status: 'todo', startAt: '2026-12-01', inboxRisk: 1 },
    { id: 3, status: 'todo', startAt: '2026-12-01', weeklyNotices: [{ id: 1 }] },
  ]);
  assert.equal(inboxCounts(rows).todo, 3);
});
test('managed risks have dates and task links, total deduplicates identities', () => {
  const task = { id: 1, status: 'doing', title: '任务', startAt: '2026-10-01', dueAt: '2026-11-04', inboxRisk: 1 };
  const group = { projectId: 8, name: '项目', tasks: [task] };
  const rows = buildInbox({ ownedTasks: [group] }, [group], [], [], '2026-11-03');
  const owned = rows.find(r => r.category === 'owned');
  assert.ok(owned);
  assert.equal(owned.startAt, task.startAt);
  assert.equal(owned.path, '/tasks?focusProject=8&taskId=1');
  assert.equal(inboxCounts(rows).all, 1);
  assert.equal(inboxCounts(rows).owned, 1);
  assert.equal(ctx.exports.inboxFilter('owned'), 'owned');
});
test('confirmation and managed risk share identity without losing risk or schedule', () => {
  const group = { projectId: 1, tasks: [{ id: 7, status: 'pending_confirm', startAt: '2026-11-01', inboxRisk: 2 }] };
  const rows = buildInbox({ confirm: [group], ownedTasks: [group] }, [], [], [], '2026-11-03');
  assert.equal(inboxCounts(rows).all, 1);
  assert.equal(rows.find(r => r.category === 'approve').risk, 2);
  assert.equal(rows.find(r => r.category === 'approve').startAt, '2026-11-01');
});
test('historical managed missing weeks remain visible on the deduplicated approval row', () => {
  const weeks = [{ weekStart: '2026-09-07' }, { weekStart: '2026-09-14' }];
  const task = { id: 7, title: '历史缺填', status: 'pending_accept' };
  const group = { projectId: 1, tasks: [task] };
  const owned = { projectId: 1, tasks: [{ ...task, weeklyNotices: weeks }] };
  const rows = buildInbox({ accept: [group], ownedTasks: [owned] }, [], [], [], '2026-11-03');
  const current = ctx.exports.currentInboxRows(rows);
  assert.equal(current.length, 1);
  assert.equal(current[0].category, 'approve');
  assert.equal(current[0].weeklyNotices.length, 2);
  assert.equal(inboxCounts(rows).owned, 1);
});

test('weekly amendment requests enter approval inbox with exact weekly report links', () => {
 const rows=buildInbox({weeklyAmendments:[{id:8,projectId:5,projectName:'Project',weekStart:'2026-11-02',reason:'Correction'}]},[],[],[],'2026-11-06');
 assert.equal(rows.length,1); assert.equal(rows[0].category,'approve');
 assert.equal(rows[0].approvalType,'weekly-amendment');
 assert.equal(rows[0].path,'/daily-report?tab=weekly&projectId=5&weekStart=2026-11-02');
 assert.equal(rows[0].mobilePath,'/mobile/daily-report?tab=weekly&projectId=5&weekStart=2026-11-02');
});

test('weekly rejection result shows reason, read state and report links in inbox',()=>{
 const notices=[{id:12,project_id:5,project_name:'Project',kind:'weekly_amendment_result',payload:{title:'周报修改申请已退回',text:'请补充实际成果',path:'/daily-report?tab=weekly&projectId=5&weekStart=2026-11-02',mobilePath:'/mobile/daily-report?tab=weekly&projectId=5&weekStart=2026-11-02',label:'查看并修改周报'}}];
 const row=buildInbox({},[],notices,[])[0];assert.equal(row.category,'inform');assert.equal(row.description,'请补充实际成果');
 assert.equal(row.mobilePath,notices[0].payload.mobilePath);assert.equal(row.action,'查看并修改周报');assert.ok(row.acknowledge);
 notices[0].acknowledged_at='2026-11-06';assert.equal(buildInbox({},[],notices,[])[0].done,true);
});
