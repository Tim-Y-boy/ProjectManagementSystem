require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {WeeklyReportReminderService}=require('../src/modules/tasks/weekly-report-reminder.service');
const {config}=require('../src/config/config');
test('Friday 16:00 Beijing; current week only, successful group delivery deduplicates',async()=>{
 const metadata=Reflect.getMetadata('SCHEDULE_CRON_OPTIONS',WeeklyReportReminderService.prototype.scheduled);
 assert.equal(metadata.cronTime,'0 0 16 * * *');
 assert.equal(metadata.timeZone,'Asia/Shanghai');
 let delivered=false; const cards=[];
 const runner={connect:async()=>{},release:async()=>{},query:async sql=>sql.includes('pg_try')?[{locked:true}]:sql.includes('SELECT id')&&delivered?[{id:1}]:[]};
 const service=new WeeklyReportReminderService({query:async()=>[],createQueryRunner:()=>runner},{notificationRows:async()=>[
  {projectId:1,projectName:'本周项目',ownerName:'负责人',weekStart:'2026-11-09',status:'missing'},
  {projectId:2,projectName:'历史项目',weekStart:'2026-11-02',status:'missing'},
  {projectId:3,projectName:'已交项目',weekStart:'2026-11-09',status:'submitted'}
 ]},{sendGroupCard:async(type,target,card)=>{cards.push(card);delivered=true;return {success:true}}});
 const targets=config.feishu.weeklyProgressGroupTargets; const url=process.env.WEB_FRONT_URL;
 config.feishu.weeklyProgressGroupTargets=['test'];process.env.WEB_FRONT_URL='https://example.invalid';
 try {await service.dispatch(new Date('2026-11-13T16:00:00+08:00'));await service.dispatch(new Date('2026-11-13T16:00:00+08:00'));
 assert.equal(cards.length,1);assert.match(JSON.stringify(cards[0]),/本周项目/);assert.doesNotMatch(JSON.stringify(cards[0]),/历史项目|已交项目/);
 } finally {config.feishu.weeklyProgressGroupTargets=targets;if(url===undefined)delete process.env.WEB_FRONT_URL;else process.env.WEB_FRONT_URL=url;}
});
