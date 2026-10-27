// Local PostgreSQL only. Creates an isolated schema; never touches business rows or sends messages.
// Run from server: node -r ts-node/register/transpile-only test/closure-database.integration.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const env=require('dotenv').parse(fs.readFileSync('.env'));
if(!['localhost','127.0.0.1','::1'].includes(env.DB_HOST||'localhost'))throw new Error('Local database only');
const {DataSource}=require('typeorm'); const {AllEntities,Project,Task}=require('../src/entities');
const {ClosuresService}=require('../src/modules/closures/closures.service');
const {TasksService}=require('../src/modules/tasks/tasks.service');
const {ProjectFreezeInterceptor}=require('../src/modules/closures/project-freeze.interceptor');
const {of}=require('rxjs');
const options={type:'postgres',host:env.DB_HOST||'localhost',port:Number(env.DB_PORT||5432),username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE,logging:false};
const schema=`closure_it_${process.pid}`; if(!/^closure_it_\d+$/.test(schema))throw new Error('Invalid test schema');
const control=new DataSource(options); let db;let created=false;let checks=0;
const check=(condition)=>{assert.ok(condition,`PostgreSQL check ${checks+1}`);checks++;};
const user=(id,roles=['member'])=>({userId:id,roles,name:`测试${id}`,managedDeptIds:[]});
const application={background:'背景',objective:'目标',outcome:'成果',charterFileIds:[],noCharterReason:'历史项目',reviewerIds:[4]};
async function main(){
 await control.initialize();await control.query(`CREATE SCHEMA "${schema}"`);created=true;
 db=new DataSource({...options,schema,extra:{options:`-c search_path=${schema}`},entities:AllEntities,migrations:[path.resolve('src/migrations/*.ts')]});await db.initialize();
 const migrations=await db.runMigrations();check(migrations.length>=13);check((await db.runMigrations()).length===0);
 // Upgrade history must be explicitly unknown; rollback/reapply only the empty extension tables in this isolated schema.
 const {CompleteClosureWorkflow1789689600000}=require('../src/migrations/1789689600000-CompleteClosureWorkflow');
 const extension=new CompleteClosureWorkflow1789689600000();const migrationRunner=db.createQueryRunner();await migrationRunner.connect();
 try{await extension.down(migrationRunner);await db.query(`INSERT INTO projects(id,name,created_by) VALUES(9000,'迁移前历史项目',1)`);await extension.up(migrationRunner);
 check((await db.query(`SELECT snapshot FROM project_plan_baselines WHERE project_id=9000`))[0].snapshot.historicalUnknown===true);
 }finally{await migrationRunner.release();}
 await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(1,'测试项目负责人','it_owner'),(2,'MOCK总经办','it_gm'),(3,'测试HR','it_hr'),(4,'阅览人员','it_reader'),(5,'无关人员','it_other')`);
 await db.query(`INSERT INTO departments(id,name,feishu_dept_id,head_user_id) VALUES(1,'测试部门','it_dept',1),(2,'人力资源部','it_hr',3),(3,'总经办','it_gm',2)`);
 process.env.PLAN_FINAL_APPROVER_USER_ID='2';process.env.PROJECT_HR_NOTIFY_USER_ID='3';
 await db.query(`INSERT INTO departments(id,name,feishu_dept_id,head_user_id) VALUES(4,'审核部门','it_review',4)`);
 const rules=[{id:3,departmentId:4,departmentName:'审核部门',enabled:true,mode:'required',question:'必审',boundary:'',checklist:['核实成果']}];
 await db.query('UPDATE closure_rule_config SET rules=$1 WHERE id=1',[JSON.stringify(rules)]);
 application.scope={version:1,projectDeptId:1,heads:{4:4},decisions:[]};
 const checklist=[{departmentId:4,items:[{answer:'yes',note:''}]}];
 const s=new ClosuresService(db,{syncReviewCards:async()=>{},sendCard:async()=>({success:true})});
 const originalSubmit=s.submit.bind(s);
 s.submit=async(actor,id,data)=>originalSubmit(actor,id,{...data,scope:{...data.scope,identity:(await s.preview(actor,id)).scope.identity}});
 const [p]=await db.query(`INSERT INTO projects(name,dept_id,created_by,owner_id,end_at) VALUES('隔离测试项目',1,1,1,CURRENT_DATE) RETURNING *,end_at::text AS end_at`);
 const [t]=await db.query(`INSERT INTO tasks(project_id,title,creator_id,status,due_at,completed_at) VALUES($1,'测试任务',1,'done',CURRENT_DATE-1,NOW()-INTERVAL '1 hour') RETURNING *`,[p.id]);
 const tasks=Object.create(TasksService.prototype);tasks.projects=db.getRepository(Project);tasks.notifyProjectPlanLocked=async()=>{};
 tasks.tasks=db.getRepository(Task);
 await db.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,from_status,to_status) VALUES($1,$2,4,'transition','doing','pending_accept'),($1,$2,1,'transition','pending_accept','done')`,[t.id,p.id]);
 const reviewed=await tasks.approvalRecords(user(1),'history');check(reviewed.some(r=>r.kind==='accept'&&r.path.includes('taskId='+t.id)));
 check((await tasks.approvalRecords(user(4),'mine')).some(r=>r.kind==='accept'));
 check((await tasks.approvalRecords(user(5),'history')).length===0);
 check((await tasks.approvalRecords(user(5),'mine')).length===0);
 await assert.rejects(tasks.approvalRecords(user(1),'all'),/审批记录类型无效/);
 const [confirmation]=await db.query(`INSERT INTO tasks(project_id,title,creator_id,status) VALUES($1,'待确认任务',4,'pending_confirm') RETURNING id`,[p.id]);
 check((await tasks.pendingConfirmationTasks({...user(1),deptId:1})).some(r=>String(r.id)===String(confirmation.id)));
 check((await tasks.pendingConfirmationTasks({...user(5),deptId:2})).length===0);
 check((await tasks.pendingConfirmationTasks(user(1,['admin']))).some(r=>String(r.id)===String(confirmation.id)));
 await db.query(`DELETE FROM tasks WHERE id=$1`,[confirmation.id]);
 await tasks.setPlanLocked(user(1,['admin']),Number(p.id),true);
 const [baseline]=await db.query(`SELECT snapshot FROM project_plan_baselines WHERE project_id=$1`,[p.id]);check(baseline.snapshot.project.end_at===p.end_at);
 await tasks.setPlanLocked(user(1,['admin']),Number(p.id),false);await db.query(`UPDATE projects SET end_at=CURRENT_DATE+2 WHERE id=$1`,[p.id]);await tasks.setPlanLocked(user(1,['admin']),Number(p.id),true);
 check((await db.query(`SELECT snapshot FROM project_plan_baselines WHERE project_id=$1`,[p.id]))[0].snapshot.project.end_at===p.end_at);
 const [d]=await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content) VALUES($1,$2,1,CURRENT_DATE-1,'截止日前工作，今天补录') RETURNING *`,[p.id,t.id]);
 await s.markSupplement(user(1),Number(t.id),Number(d.id),'历史补录');await s.markSupplement(user(1),Number(t.id),Number(d.id),'重复操作');
 let notices=await s.inbox(user(2));check(notices.length===1);await assert.rejects(s.acknowledge(user(5),Number(notices[0].id)),{status:403});checks++;
 await s.acknowledge(user(2),Number(notices[0].id));check(!!(await s.inbox(user(2)))[0].acknowledged_at);
 await s.revokeSupplement(user(1),Number(t.id),Number(d.id),'supplemented');check((await s.inbox(user(2))).length===2);
 const [invalid]=await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content,status) VALUES($1,$2,1,CURRENT_DATE,'历史不符合日期条件记录','exempted') RETURNING *`,[p.id,t.id]);
 let audit=await s.supplementAudit(user(3));check(audit.some(r=>r.id===invalid.id));
 await s.followup(user(3),'supplement_audit',Number(invalid.id),{status:'resolved',comment:'已核查，保留历史记录并安排纠正'});
 check((await s.supplementAudit(user(3)))[0].handling_status==='resolved');
 await assert.rejects(s.markSupplement(user(1),Number(t.id),Number(invalid.id),'无效'),/工作日期超过/);checks++;
 await s.observeProject(Number(p.id));let delays=await s.delays(user(3));check(delays.length>0);
 await s.followup(user(1),'delay',Number(delays[0].id),{status:'processing',comment:'确认验收时间与工作日期差异'});
 check((await s.delayDetail(user(3),Number(delays[0].id))).history.length===1);
 await assert.rejects(s.delayDetail(user(5),Number(delays[0].id)),{status:403});checks++;
 await s.grantHr(user(1,['admin']),{userId:4,deptId:1});check(await s.canRead(user(4),Number(p.id)));
 const access=await s.hrAccess(user(1,['admin']));await s.revokeHr(user(1,['admin']),Number(access.grants[0].id));check(!await s.canRead(user(4),Number(p.id)));
 const lock=db.createQueryRunner();await lock.connect();await lock.query(`SELECT pg_advisory_lock(21017,hashtext($1))`,[String(p.id)]);
 try{await assert.rejects(s.submit(user(1),Number(p.id),application),{status:409});checks++;}finally{await lock.query(`SELECT pg_advisory_unlock(21017,hashtext($1))`,[String(p.id)]);await lock.release();}
 const first=await s.submit(user(1),Number(p.id),application);await assert.rejects(s.withdraw(user(2),Number(first.id),'越权撤回'),{status:403});checks++;
 await s.withdraw(user(1),Number(first.id),'补充说明后再申请');check((await s.one(user(1),Number(first.id))).status==='withdrawn');
 const request=await s.submit(user(1),Number(p.id),application);
 const guard=new ProjectFreezeInterceptor(db,s);await assert.rejects(guard.run({method:'POST',route:{path:'/projects/:id'},params:{id:p.id}},{handle:()=>of('bad')}),/审批中/);checks++;
 await assert.rejects(s.review(user(1),Number(request.id),true,''),{status:403});checks++;
 await s.review(user(4),Number(request.id),true,'verified',checklist);
 await s.review(user(2),Number(request.id),true,'同意结项');const report=await s.one(user(3),Number(request.id));check(report.report.firstPlanEnd===p.end_at);check(report.report.version===1);check(!report.hrNotice);check(report.reportHtml.includes('doc-title'));check(report.reportHtml.includes('doc-title'));
 const exported=await s.exportReport(user(3),Number(request.id));check(exported.content.includes('sec-head'));check(exported.content.includes('sec-head'));
 check((await db.query(`SELECT count(*)::int AS n FROM closure_notices WHERE event_key=$1`,[`closure:${request.id}:hr`]))[0].n===0);
 await assert.rejects(guard.run({method:'POST',route:{path:'/projects/:id'},params:{id:p.id}},{handle:()=>of('bad')}),/已结项/);checks++;
 const reopen=await s.requestReopen(user(1),Number(request.id),'验收依据需纠正');await assert.rejects(s.reviewReopen(user(1),Number(reopen.id),true,'同意'),{status:403});checks++;
 await s.reviewReopen(user(2),Number(reopen.id),true,'同意重开核实');const old=await s.one(user(3),Number(request.id));check(old.status==='voided');assert.deepEqual(old.report,report.report);checks++;
 check((await s.inbox(user(3))).some(n=>n.payload.title==='结项报告已失效｜项目重开'));
 check((await s.exportReport(user(3),Number(request.id))).content.includes('已失效'));
 const next=await s.submit(user(1),Number(p.id),application);await s.review(user(4),Number(next.id),true,'verified',checklist);await s.review(user(2),Number(next.id),true,'核实完毕');check((await s.one(user(3),Number(next.id))).report.version===2);
 // Time differences are report facts, not mandatory applicant explanations.
 const [lateProject]=await db.query(`INSERT INTO projects(name,dept_id,created_by,owner_id,end_at,plan_locked) VALUES('超期结项无说明测试',1,1,1,CURRENT_DATE-2,true) RETURNING *`);
 await db.query(`INSERT INTO tasks(project_id,title,creator_id,status,due_at,completed_at) VALUES($1,'已验收任务',1,'done',CURRENT_DATE-2,NOW()-INTERVAL '4 days')`,[lateProject.id]);
 const lateRequest=await s.submit(user(1),Number(lateProject.id),application);
 check(!lateRequest.delay_reason&&!lateRequest.overdue_reason);
 check(lateRequest.snapshot.timingAlerts.some(v=>v.includes('才申请结项')));
 await s.review(user(4),Number(lateRequest.id),true,'verified',checklist);
 await s.review(user(2),Number(lateRequest.id),true,'同意结项，后续跟进');
 const lateReport=await s.one(user(3),Number(lateRequest.id));
 check(lateReport.report.timingAlerts.some(v=>v.includes('结项生效时已超过批准截止日期')));
 check(!!lateReport.report.completedAt&&!!lateReport.report.requestedAt&&!!lateReport.report.closedAt);
 const reportNotices=await db.query(`SELECT recipient_id,kind,payload FROM closure_notices WHERE event_key IN ($1,$2) ORDER BY recipient_id`,[`closure:${lateRequest.id}:hr`,`closure:${lateRequest.id}:lead-report`]);
 check(reportNotices.length===0);
 check((await db.query(`SELECT recipient_id FROM closure_notices WHERE event_key=$1`,[`closure:${lateRequest.id}:result`])).length===1);
 // Historical report notifications must still be corrected after reopening.
 await db.query(`INSERT INTO closure_notices(event_key,project_id,recipient_id,kind,payload) VALUES($1,$2,2,'closure_result',$3)`,[`closure:${lateRequest.id}:lead-report`,lateRequest.project_id,{title:'结项报告已生成',text:'历史通知'}]);
 // A new reviewer may handle reopening; the original report recipients still need the correction.
 process.env.PLAN_FINAL_APPROVER_USER_ID='4';
 try {
  const correction=await s.requestReopen(user(1),Number(lateRequest.id),'纠正验收依据');
  await s.reviewReopen(user(4),Number(correction.id),true,'同意重开');
  const oldLeaderNotice=(await db.query(`SELECT payload FROM closure_notices WHERE event_key=$1`,[`closure:${lateRequest.id}:lead-report`]))[0];
  check(!!oldLeaderNotice.payload.invalidatedAt);
  check(oldLeaderNotice.payload.title==='原结项报告已失效');
  check((await db.query(`SELECT recipient_id FROM closure_notices WHERE event_key=$1`,[`reopen:${correction.id}:result`])).some(n=>Number(n.recipient_id)===2));
 } finally { process.env.PLAN_FINAL_APPROVER_USER_ID='2'; }
 await s.deliverNotices();check((await db.query(`SELECT count(*)::int AS n FROM closure_notices WHERE sent_at IS NOT NULL`))[0].n>0);
 console.log(`PASS: ${checks} PostgreSQL checks; migrations, baseline, supplement, access, locking, withdrawal, approval, HR, reopen, immutable versions, delivery. No real messages.`);
}
main().catch(e=>{console.error(e.message);console.error(e.stack);process.exitCode=1;}).finally(async()=>{if(db?.isInitialized)await db.destroy();if(created)await control.query(`DROP SCHEMA "${schema}" CASCADE`);if(control.isInitialized)await control.destroy();});
