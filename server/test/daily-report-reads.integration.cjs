const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { AllEntities } = require('../src/entities');
const { Task } = require('../src/entities/task.entity');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost','127.0.0.1','::1'].includes(env.DB_HOST || 'localhost'));
const options = {type:'postgres',host:env.DB_HOST || 'localhost',port:Number(env.DB_PORT || 5432),username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE};
const schema=`daily_reads_it_${process.pid}`;
const control=new DataSource(options);
let db;
async function main() {
 await control.initialize(); await control.query(`CREATE SCHEMA "${schema}"`);
 try {
  db=new DataSource({...options,schema,extra:{options:`-c search_path=${schema}`},entities:AllEntities,migrations:[path.resolve('src/migrations/*.ts')]});
  await db.initialize(); await db.runMigrations();
  await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(1,'测试甲','reads_a'),(2,'测试乙','reads_b')`);
  const svc=Object.create(TasksService.prototype);
  svc.tasks=db.getRepository(Task);
  svc.previousReportWorkday=async()=>latest;
  svc.closures={recipient:async()=>1};
  svc.queryDailyReport=async date=>({date,items:[]});
  let latest='2026-10-16';
  const a={userId:1,roles:[]},b={userId:2,roles:['admin']};
  assert.equal((await svc.dailyReportStatus(a)).unreadCount,1);
  latest='2026-10-19';
  assert.equal((await svc.dailyReportStatus(a)).unreadCount,2,'weekend does not add reports');
  await svc.dailyReport(a,'2026-10-19');
  assert.deepEqual((await svc.dailyReportStatus(a)).unreadDates,['2026-10-16']);
  await svc.dailyReport(a,'2026-10-19');
  assert.equal((await svc.dailyReportStatus(a)).unreadCount,1,'reread is idempotent');
  await svc.dailyReport(a,'2026-10-16');
  assert.equal((await svc.dailyReportStatus(a)).unreadCount,0);
  assert.equal((await svc.dailyReportStatus(b)).unreadCount,1,'accounts are independent');
  await db.query(`INSERT INTO holidays(date,kind) VALUES('2026-10-20','holiday'),('2026-10-24','makeup')`);
  latest='2026-10-24';
  assert.deepEqual((await svc.dailyReportStatus(a)).unreadDates,['2026-10-21','2026-10-22','2026-10-23','2026-10-24']);
  assert.equal((await svc.dailyReportStatus({userId:2,roles:[]})).unreadCount,0);
  svc.queryDailyReport=async()=>{throw Error('load failed');};
  await assert.rejects(svc.dailyReport(a,'2026-10-21'),/load failed/);
  assert.equal((await svc.dailyReportStatus(a)).unreadCount,4,'failed reads remain unread');
  console.log('PASS: unread days, independent accounts, rereads, failed reads, weekends and holiday overrides');
 } finally {
  if(db?.isInitialized)await db.destroy();
  await control.query(`DROP SCHEMA "${schema}" CASCADE`);await control.destroy();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
