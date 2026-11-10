const {test}=require('node:test');
const assert=require('node:assert/strict');
const {weeklyReminderDate}=require('../src/modules/holidays/work-calendar');
const {TasksService}=require('../src/modules/tasks/tasks.service');
const {requiredWeeks}=require('../src/modules/tasks/weekly-progress.rules');
test('normal Friday, shortened week, full holiday week, makeup weekend and year boundary',()=>{
 assert.equal(weeklyReminderDate('2026-11-09',new Map()),'2026-11-13');
 const holidays=new Map([['2026-11-12','holiday'],['2026-11-13','holiday']]);
 assert.equal(weeklyReminderDate('2026-11-09',holidays),'2026-11-11');
 for(const d of ['09','10','11'])holidays.set(`2026-11-${d}`,'holiday');
 assert.equal(weeklyReminderDate('2026-11-09',holidays),null);
 holidays.set('2026-11-15','makeup');
 assert.equal(weeklyReminderDate('2026-11-09',holidays),'2026-11-15');
 assert.equal(weeklyReminderDate('2026-12-28',new Map([['2027-01-01','holiday']])),'2026-12-31');
});
test('advanced progress reminder includes the current shortened week at 14:00',()=>{
 const holidays=new Map([['2026-11-12','holiday'],['2026-11-13','holiday']]);
 const task={status:'doing',created_at:'2026-11-09T00:00:00+08:00'};
 assert.deepEqual(requiredWeeks(task,[],task.created_at,new Date('2026-11-11T14:00:00+08:00'),holidays),['2026-11-09']);
 assert.deepEqual(requiredWeeks(task,[],task.created_at,new Date('2026-11-11T13:59:00+08:00'),holidays),[]);
});
test('leader report rests on holidays even with pending weekly summaries, resumes on makeup day',async()=>{
 const service=Object.create(TasksService.prototype);let work=false,calls=0;
 service.holidays={isWorkday:async()=>work};
 service.weeklyNotifications={withLeaderSummary:async()=>{calls++;return {sent:true}}};
 assert.equal((await service.sendDailyWorkReport(new Date('2026-11-09T09:00:00+08:00'))).skipped,'rest_day');
 assert.equal(calls,0);work=true;
 assert.equal((await service.sendDailyWorkReport(new Date('2026-11-14T09:00:00+08:00'))).sent,true);
 assert.equal(calls,1);
});
