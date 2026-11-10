const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WeeklyProgressService } = require('../src/modules/tasks/weekly-progress.service');

function fixture(overrides = {}) {
  const state = { enabled: '2026-09-07T00:00:00+08:00',
    task: { id: '1', status: 'doing', start_at: '2026-09-07', created_at: '2026-09-07T09:00:00+08:00', project_status: 'active', closure_state: 'none', plan_locked: true, has_children: false },
    logs: [], holidays: [], updates: [
      { work_date: '2026-09-08', content: '第一周工作', user_id: 1 },
      { work_date: '2026-09-22', content: '第三周工作', user_id: 1 },
    ], ...overrides };
  const queries = [];
  const manager = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('weekly_progress_settings')) return state.enabled ? [{ enabled_at: state.enabled }] : [];
    if (sql.includes('FROM tasks t')) return state.task ? [state.task] : [];
    if (sql.includes('FROM task_logs')) return state.logs;
    if (sql.includes('FROM task_daily_updates')) return state.updates;
    if (sql.includes('FROM holidays')) return state.holidays;
    throw Error('Unexpected query: ' + sql);
  } };
  const service = new WeeklyProgressService({ manager }, { sendCard: () => { throw Error('No notifications during validation'); } });
  return { service, state, queries };
}
const now = new Date('2026-09-23T10:00:00+08:00');

const { requiredWeeks } = require('../src/modules/tasks/weekly-progress.rules');
test('submission checks current week before Friday, reminder waits', async()=>{
 const f=fixture({updates:[]});
 const early=new Date('2026-09-08T10:00:00+08:00');
 assert.deepEqual(await f.service.missingWeeksForTask(1,early),[{weekStart:'2026-09-07',weekEnd:'2026-09-13'}]);
 assert.deepEqual(requiredWeeks(f.state.task,[],f.state.enabled,early,new Map()),[]);
});
test('planned dates do not truncate overdue execution or invent execution before start',async()=>{
 const f=fixture({updates:[]}); f.state.task.due_at='2026-09-09';
 f.state.logs=[{from_status:'todo',to_status:'doing',created_at:'2026-09-15T09:00:00+08:00'}];
 assert.deepEqual(await f.service.missingWeeksForTask(1,now),[
 {weekStart:'2026-09-14',weekEnd:'2026-09-20'},{weekStart:'2026-09-21',weekEnd:'2026-09-27'}]);
});
test('waiting for acceptance adds no weeks; returned task resumes execution',async()=>{
 const f=fixture({updates:[]}); f.state.task.status='pending_accept';
 f.state.logs=[{from_status:'doing',to_status:'pending_accept',created_at:'2026-09-08T09:00:00+08:00'}];
 assert.deepEqual(await f.service.missingWeeksForTask(1,now),[{weekStart:'2026-09-07',weekEnd:'2026-09-13'}]);
 f.state.logs.push({from_status:'pending_accept',to_status:'doing',created_at:'2026-09-22T09:00:00+08:00'},
 {from_status:'doing',to_status:'pending_accept',created_at:'2026-09-22T10:00:00+08:00'});
 assert.equal((await f.service.missingWeeksForTask(1,now)).length,2);
});
test('completed before activation and historical work are not pursued',async()=>{
 const f=fixture({updates:[],enabled:'2026-09-21T00:00:00+08:00'}); f.state.task.status='done';
 f.state.logs=[{from_status:'doing',to_status:'pending_accept',created_at:'2026-09-15T09:00:00+08:00'},
 {from_status:'pending_accept',to_status:'done',created_at:'2026-09-16T09:00:00+08:00'}];
 assert.deepEqual(await f.service.missingWeeksForTask(1,now),[]);
});
test('submission and reminder agree after Friday, work-date entries from any author satisfy both',async()=>{
 const f=fixture(); const friday=new Date('2026-09-25T15:00:00+08:00');
 const missing=await f.service.missingWeeksForTask(1,friday);
 const expected=requiredWeeks(f.state.task,[],f.state.enabled,friday,new Map()).filter(w=>!f.state.updates.some(u=>u.work_date>=w&&u.work_date<=require('../src/modules/tasks/weekly-progress.rules').addDays(w,6)));
 assert.deepEqual(missing.map(w=>w.weekStart),expected);
 assert.deepEqual(expected,['2026-09-14']);
 f.state.updates.push({work_date:'2026-09-18',content:'另一执行人补填',user_id:2});
 assert.deepEqual(await f.service.missingWeeksForTask(1,friday),[]);
});
test('holidays do not require entries; makeup workdays do',async()=>{
 const f=fixture({updates:[],holidays:['07','08','09','10','11'].map(d=>({date:'2026-09-'+d,kind:'holiday'}))});
 const end=new Date('2026-09-13T20:00:00+08:00');
 assert.deepEqual(await f.service.missingWeeksForTask(1,end),[]);
 f.state.holidays.push({date:'2026-09-12',kind:'makeup'});
 assert.equal((await f.service.missingWeeksForTask(1,end)).length,1);
});
test('not started tasks and disabled checking do not require entries',async()=>{
 const f=fixture({updates:[]}); f.state.task.status='todo';
 assert.deepEqual(await f.service.missingWeeksForTask(1,now),[]);
 f.state.task.status='doing'; f.state.enabled=null;
 assert.deepEqual(await f.service.missingWeeksForTask(1,now),[]);
});