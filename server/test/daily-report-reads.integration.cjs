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
  assert.equal((await svc.dailyReportStatus({userId:2,roles:[]})).unreadCount,0,'no participating project progress produces no unread dates');
  svc.queryDailyReport=async()=>{throw Error('load failed');};
  await assert.rejects(svc.dailyReport(a,'2026-10-21'),/load failed/);
  assert.equal((await svc.dailyReportStatus(a)).unreadCount,4,'failed reads remain unread');
  await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(3,'项目负责人','reads_owner'),(4,'执行人','reads_executor'),(5,'无关人员','reads_other')`);
  await db.query(`INSERT INTO projects(id,name,created_by,owner_id) VALUES(1,'负责项目',1,3),(2,'参与项目',1,1),(3,'无关项目',1,1),(4,'共同负责项目',1,1)`);
  await db.query(`INSERT INTO project_owners(project_id,user_id) VALUES(4,3)`);
  await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,status) VALUES
    (1,1,'负责项目任务',1,2,'doing'),(2,2,'参与任务',1,NULL,'doing'),(3,2,'同项目其他任务',1,2,'doing'),
    (4,3,'无关任务',1,2,'doing'),(5,4,'共同负责项目任务',1,2,'doing')`);
  await db.query(`INSERT INTO task_assignees(task_id,role,user_id) VALUES(2,'assignee',4)`);
  await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content,created_at)
    SELECT project_id,id,2,'2026-10-24','项目隔离测试','2026-10-24T09:00:00+08:00' FROM tasks`);
  delete svc.queryDailyReport;
  svc.dailyUpdates=db.getRepository('TaskDailyUpdate');
  const owner={userId:3,roles:['member']},executor={userId:4,roles:['member']},outsider={userId:5,roles:['member']};
  assert.equal((await svc.dailyReportStatus(owner)).unreadCount,1);
  assert.equal((await svc.dailyReportStatus(executor)).unreadCount,1);
  assert.equal((await svc.dailyReportStatus(outsider)).unreadCount,0);
  const taskIds=report=>report.items.map(row=>Number(row.taskId)).sort((a,b)=>a-b);
  assert.deepEqual(taskIds(await svc.dailyReport(owner,latest)),[1,5],'owner includes primary and co-owned projects');
  assert.deepEqual(taskIds(await svc.dailyReport(executor,latest)),[2,3],'executor sees other tasks in the same project');
  assert.deepEqual(taskIds(await svc.dailyReport(outsider,latest)),[],'outsider cannot access project progress');
  assert.deepEqual(taskIds(await svc.dailyReport(a,latest)),[1,2,3,4,5],'configured GM remains unrestricted');
  assert.deepEqual(taskIds(await svc.dailyReport(b,latest)),[1,2,3,4,5],'admin remains unrestricted');
  assert.equal((await svc.dailyReportStatus(executor)).unreadCount,0);
  console.log('PASS: owned/co-owned projects, project-wide execution access, outsider isolation, scoped unread counts and privileged access');
  console.log('PASS: unread days, independent accounts, rereads, failed reads, weekends and holiday overrides');
 } finally {
  if(db?.isInitialized)await db.destroy();
  await control.query(`DROP SCHEMA "${schema}" CASCADE`);await control.destroy();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
