const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { ProjectWeeklyReportsService } = require('../src/modules/project-weekly-reports/project-weekly-reports.service');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost','127.0.0.1','::1'].includes(env.DB_HOST || 'localhost'));
const options = {type:'postgres',host:env.DB_HOST || 'localhost',port:Number(env.DB_PORT || 5432),username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE};
const schema = `project_weekly_it_${process.pid}`;
const control = new DataSource(options);
const RealDate = Date;
let now = '2026-11-06T06:00:00Z';
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return RealDate.parse(now); } };
let db;
async function main() {
  await control.initialize();
  await control.query(`CREATE SCHEMA "${schema}"`);
  try {
    db = new DataSource({...options,schema,extra:{options:`-c search_path=${schema}`},migrations:[path.resolve('src/migrations/*.ts')]});
    await db.initialize(); await db.runMigrations();
    await db.query(`UPDATE project_weekly_report_settings SET enabled_at='2026-11-04T00:00:00+08:00'`);
    await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES (1,'Owner','weekly_owner'),(2,'Coowner','weekly_coowner'),(3,'Executor','weekly_executor'),(4,'Other','weekly_other')`);
    await db.query(`INSERT INTO projects(id,name,owner_id,created_by,plan_locked,start_at,created_at) VALUES
      (1,'Normal',1,1,true,'2026-11-01','2026-10-01'),(2,'Future',1,1,true,'2027-01-01','2026-10-01'),
      (3,'Closed',1,1,true,'2026-11-01','2026-10-01'),(4,'Terminated',1,1,true,'2026-11-01','2026-10-01')`);
    await db.query(`UPDATE projects SET status='archived',closure_state='closed',archived_at='2026-11-04T02:00:00Z' WHERE id=3`);
    await db.query(`UPDATE projects SET status='archived',termination_state='terminated',terminated_at='2026-11-04T02:00:00Z' WHERE id=4`);
    await db.query(`INSERT INTO project_owners(project_id,user_id) VALUES(1,2)`);
    await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,status,due_at,created_at) VALUES(1,1,'Evidence task',1,3,'doing','2026-11-06','2026-11-02')`);
    await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content) VALUES(1,1,3,'2026-11-03','Original evidence')`);
    const svc = new ProjectWeeklyReportsService(db,{recipient:async()=>null});
    await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,status,created_at) VALUES
      (901,1,'Active with history',1,3,'doing','2026-10-01'),
      (902,1,'Completed with history',1,3,'done','2026-10-01'),
      (903,1,'Not started',1,3,'todo','2026-10-01'),
      (904,1,'Cancelled',1,3,'cancelled','2026-10-01'),
      (905,1,'Active without history',1,3,'doing','2026-10-01')`);
    await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content) VALUES
      (1,901,3,'2026-10-29','Earlier progress'),(1,902,3,'2026-10-29','Completed earlier'),
      (1,902,3,'2026-11-03','Completed this week')`);
    const evidence=await svc.evidence(1,'2026-11-02');
    assert.deepEqual(evidence.activeTasks.map(t=>Number(t.taskId)),[1,901,905]);
    assert.equal(evidence.activeTasks.find(t=>Number(t.taskId)===901).hasHistory,true);
    assert.equal(evidence.activeTasks.find(t=>Number(t.taskId)===905).hasHistory,false);
    assert.ok(evidence.updates.some(t=>Number(t.taskId)===902),'completed task with current-week progress remains visible');
    await db.query('DELETE FROM task_daily_updates WHERE task_id BETWEEN 901 AND 905');
    await db.query('DELETE FROM tasks WHERE id BETWEEN 901 AND 905');
    const user = id => ({userId:id,name:`User ${id}`,roles:['member']});
    const owner = user(1),coowner=user(2),executor=user(3),outsider=user(4);
    const body = {projectId:1,weekStart:'2026-11-02',version:0,overallStatus:'normal',achievements:'完成阶段交付并通过验证',risks:'',coordination:'',nextWeek:'张三完成后续计划并于下周五验证'};
    assert.equal((await svc.list(owner,{weekStart:'2026-10-26'})).length,0,'no pre-launch obligations');
    assert.equal((await svc.list(owner)).length,3,'future projects excluded, final weeks included');
    assert.equal((await svc.list(executor)).length,1,'member project scope');
    assert.equal((await svc.list({...outsider,roles:['leader']})).length,0,'leader follows daily scope');
    assert.equal((await svc.list({...outsider,roles:['admin']})).length,3);
    assert.equal((await svc.list({...outsider,readOnly:true})).length,3);
    svc.closures.recipient=async()=>4;
    assert.equal((await svc.list(outsider)).length,3,'configured GM can read all');
    svc.closures.recipient=async()=>null;
    assert.equal((await svc.todo({...owner,readOnly:true})).length,0);
    assert.equal(Number((await db.query('SELECT count(*) FROM project_weekly_reports'))[0].count),0,'read-only queries do not materialize obligations');
    now='2026-11-02T02:00:00Z';
    assert.equal((await svc.todo(owner)).length,3,'Monday editing starts for active project');
    await assert.rejects(svc.save({...owner,readOnly:true},body),/只读/);
    await assert.rejects(svc.save(executor,body),/负责人/);
    await assert.rejects(svc.save({...outsider,roles:['admin']},body),/负责人/);
    await assert.rejects(svc.save(coowner,body), /负责人/);
    const raced=await Promise.allSettled([svc.save(owner,{...body,nextWeek:''}),svc.save(owner,body)]);
    assert.equal(raced.filter(x=>x.status==='fulfilled').length,1,'concurrent save conflict: '+raced.filter(x=>x.status==='rejected').map(x=>x.reason.message).join('; '));
    assert.equal((await svc.todo(owner)).length,3,'draft stays pending until submitted');
    now='2026-11-06T06:00:00Z';
    const saved=await svc.save(owner,{...body,version:1});
    assert.equal(saved.status,'draft');
    assert.equal(saved.versions,undefined,'no revision history API');
    assert.equal(saved.mobilePath,'/mobile/daily-report?tab=weekly&projectId=1&weekStart=2026-11-02');
    await svc.save(owner,{...body,version:2,overallStatus:'risk',risks:'李四处理风险'});
    assert.equal(Number((await db.query('SELECT count(*) FROM project_weekly_report_versions'))[0].count),0);
    now='2026-11-09T00:59:59Z';
    assert.equal((await svc.detail(owner,1,body.weekStart)).canEdit,true);
    now='2026-11-09T01:00:00Z';
    assert.equal((await svc.detail(owner,1,body.weekStart)).canEdit,true,'overdue drafts remain editable');
        await assert.rejects(svc.save(owner,{...body,version:3,overallStatus:'',achievements:''},true),/状态/);
    await assert.rejects(svc.save(owner,{...body,version:3,nextWeek:''},true),/本周成果/);
    const closures = Object.create(require('../src/modules/closures/closures.service').ClosuresService.prototype);
    await assert.rejects(closures.assertWeeklyReportsSubmitted(1,db.manager),/无法结项/);
    const submitted=await svc.save(owner,{...body,version:3},true);
    assert.equal(submitted.status,'submitted'); assert.equal(submitted.canEdit,false);
    await assert.rejects(svc.save(owner,{...body,version:4}),/无法更改/);
    await assert.rejects(svc.save(coowner,{...body,version:4},true),/无法更改/);
    await closures.assertWeeklyReportsSubmitted(1,db.manager,new Date('2026-11-06T06:00:00Z'));
    assert.ok(!(await svc.todo(owner)).some(x=>x.projectId===1 && x.weekStart===body.weekStart),'submitted report no longer actionable');
    now='2026-11-06T06:00:00Z';
    svc.closures.recipient=async()=>4;
    const proposal={...body,version:4,draftVersion:0,reason:'Correct milestone',achievements:'Corrected outcome'};
    await assert.rejects(svc.requestAmendment(executor,proposal),/负责人/);
    await assert.rejects(svc.requestAmendment({...owner,readOnly:true},proposal),/只读/);
    await assert.rejects(svc.requestAmendment(owner,{...proposal,reason:''}),/原因/);
    await assert.rejects(svc.requestAmendment(owner,{...proposal,achievements:body.achievements}),/先修改/);
    const draft=await svc.requestAmendment(owner,{...proposal,nextWeek:''},false);
    assert.equal(draft.status,'submitted');assert.equal(draft.amendment.status,'draft');
    assert.equal((await db.query("SELECT 1 FROM closure_notices WHERE kind='weekly_amendment_review'")).length,0,'autosave never notifies');
    assert.equal(draft.achievements,body.achievements);assert.equal(draft.amendment.proposedContent.nextWeek,'');
    assert.equal((await svc.amendmentRequests(outsider)).length,0);
    assert.equal((await svc.detail(executor,1,body.weekStart)).amendment,null,'draft not exposed to project members');
    await assert.rejects(svc.requestAmendment(coowner,proposal,false),/负责人/);
    await assert.rejects(svc.requestAmendment(owner,{...proposal,draftVersion:1,nextWeek:''}),/下周重点/);
    const requested=await svc.requestAmendment(owner,{...proposal,draftVersion:1});
    assert.equal(requested.canEdit,false);assert.equal(requested.amendment.status,'pending');
    const [reviewNotice]=await db.query("SELECT * FROM closure_notices WHERE event_key=$1",['weekly-amendment:'+requested.amendment.id+':review']);
    assert.equal(Number(reviewNotice.recipient_id),4);
    const reviewSent=[];
    const reviewSender=new (require('../src/modules/closures/closures.service').ClosuresService)(db,{
      isReadOnlyRecipient:async()=>false,sendCard:async(...args)=>{reviewSent.push(args);return {success:true}},
    });
    await reviewSender.deliverNotices();await reviewSender.deliverNotices();
    assert.equal(reviewSent.length,1);assert.equal(reviewSent[0][0],'weekly_amendment_review');
    const backfill=new (require('../src/migrations/1803000000000-WeeklyAmendmentReviewNotices').WeeklyAmendmentReviewNotices1803000000000)();
    await db.query('DELETE FROM closure_notices WHERE id=$1',[reviewNotice.id]);
    const backfillRunner=db.createQueryRunner();await backfillRunner.connect();
    try {await backfill.up(backfillRunner);await backfill.up(backfillRunner);} finally {await backfillRunner.release();}
    assert.equal((await db.query("SELECT 1 FROM closure_notices WHERE event_key=$1",[reviewNotice.event_key])).length,1,'backfill deduplicates pending requests');
    assert.equal(requested.amendment.originalContent.achievements,body.achievements);
    assert.equal(requested.amendment.proposedContent.achievements,'Corrected outcome');
    assert.equal(requested.achievements,body.achievements,'pending approval leaves official content unchanged');
    assert.equal((await svc.amendmentRequests(outsider)).length,1);
    assert.equal((await svc.amendmentRequests(owner)).length,0);
    await assert.rejects(svc.requestAmendment(owner,proposal),/已有/);
    await assert.rejects(svc.requestAmendment(owner,proposal,false),/已有/);
    await assert.rejects(closures.assertWeeklyReportsSubmitted(1,db.manager),/无法结项/);
    await assert.rejects(svc.reviewAmendment(owner,{id:requested.amendment.id,approve:true}),/管理办公室/);
    await svc.reviewAmendment(outsider,{id:requested.amendment.id,approve:false,comment:'Explain more'});
    assert.equal((await svc.detail(owner,1,body.weekStart)).achievements,body.achievements);
    const [rejectionNotice]=await db.query("SELECT * FROM closure_notices WHERE event_key=$1",['weekly-amendment:'+requested.amendment.id+':result']);
    assert.equal(Number(rejectionNotice.recipient_id),1);assert.equal(rejectionNotice.kind,'weekly_amendment_result');
    assert.match(rejectionNotice.payload.text,/Explain more/);assert.equal(rejectionNotice.payload.result,'rejected');
    assert.equal(rejectionNotice.payload.path,'/daily-report?tab=weekly&projectId=1&weekStart=2026-11-02');
    assert.equal(rejectionNotice.acknowledged_at,null);
    const second=await svc.requestAmendment(owner,proposal);
    assert.equal((await db.query("SELECT 1 FROM closure_notices WHERE event_key=$1",['weekly-amendment:'+second.amendment.id+':review'])).length,1,'resubmission gets a new notice');
    await svc.reviewAmendment(outsider,{id:second.amendment.id,approve:true});
    const applied=await svc.detail(owner,1,body.weekStart);
    assert.equal(applied.canEdit,false);assert.equal(applied.status,'submitted');assert.equal(applied.version,5);
    assert.equal(applied.achievements,'Corrected outcome');
    await closures.assertWeeklyReportsSubmitted(1,db.manager);
    await assert.rejects(svc.reviewAmendment(outsider,{id:second.amendment.id,approve:true}),/已处理/);
    await assert.rejects(svc.save(owner,{...body,version:5}),/无法更改/);
    const [approvalNotice]=await db.query("SELECT * FROM closure_notices WHERE event_key=$1",['weekly-amendment:'+second.amendment.id+':result']);
    assert.equal(approvalNotice.payload.result,'approved');
    assert.equal(Number((await db.query("SELECT count(*) FROM closure_notices WHERE event_key=$1",['weekly-amendment:'+second.amendment.id+':result']))[0].count),1);
    const noticesMigration=new (require('../src/migrations/1802900000000-WeeklyAmendmentResultNotices').WeeklyAmendmentResultNotices1802900000000)();
    const noticeRunner=db.createQueryRunner();await noticeRunner.connect();
    try {
      await db.query('DELETE FROM closure_notices WHERE id=$1',[approvalNotice.id]);
      await noticesMigration.up(noticeRunner);await noticesMigration.up(noticeRunner);
      assert.equal(Number((await db.query("SELECT count(*) FROM closure_notices WHERE event_key=$1",['weekly-amendment:'+second.amendment.id+':result']))[0].count),1);
    } finally {await noticeRunner.release();}
    const sent=[];
    const noticeService=new (require('../src/modules/closures/closures.service').ClosuresService)(db,{
      isReadOnlyRecipient:async()=>false,sendCard:async(...args)=>{sent.push(args);return {success:true}},
    });
    assert.equal((await noticeService.inbox(owner)).filter(n=>n.kind==='weekly_amendment_result').length,2);
    assert.equal((await noticeService.inbox(executor)).filter(n=>n.kind==='weekly_amendment_result').length,0);
    await noticeService.deliverNotices();await noticeService.deliverNotices();
    assert.equal(sent.length,2,'results delivered once through mocked sender');
    assert.ok(sent.every(args=>args[0]==='weekly_amendment_result' && Number(args[1])===1));
    await noticeService.acknowledge(owner,Number(rejectionNotice.id));
    assert.ok((await noticeService.inbox(owner)).find(n=>String(n.id)===String(rejectionNotice.id)).acknowledged_at);
    const [snapshot]=await db.query('SELECT original_report FROM project_weekly_report_amendments WHERE id=$1',[second.amendment.id]);
    assert.equal(snapshot.original_report.achievements,body.achievements);
    svc.closures.recipient=async()=>null;
    await svc.save(owner,{...body,projectId:3},true);
    await svc.save(owner,{...body,projectId:4});
    await svc.collect();
    await db.query(`UPDATE project_weekly_reports SET status='missing',version=0 WHERE project_id=4`);
    await db.query(`UPDATE projects SET owner_id=2 WHERE id=4`);
    now='2026-11-13T06:00:00Z';
    assert.equal((await svc.list(owner,{weekStart:'2026-11-09'})).length,1,'no new reports after closed or terminated week');
    assert.ok((await svc.todo(coowner)).some(x=>x.projectId===4 && x.weekStart==='2026-11-02'),'unsubmitted history remains actionable');
    assert.ok((await svc.notificationRows()).some(x=>x.projectId===4 && x.weekStart==='2026-11-02'));
    const summary=await svc.summaryForLeader('2026-11-02');
    assert.equal(summary.highlights.length,2); assert.equal(summary.missingCount,1);
    await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,status,created_at) VALUES(2,2,'Started early',1,'doing','2026-11-10')`);
    await db.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,to_status,created_at) VALUES(2,2,1,'start','doing','2026-11-14T01:00:00Z')`);
    assert.ok(!(await svc.list(owner,{weekStart:'2026-11-09'})).some(x=>x.projectId===2),'future execution timestamps do not activate reporting');
    await db.query(`UPDATE task_logs SET created_at='2026-11-10T01:00:00Z' WHERE project_id=2`);
    assert.ok((await svc.list(owner,{weekStart:'2026-11-09'})).some(x=>x.projectId===2),'actual execution starts reporting before planned start');
    assert.ok(!(await svc.list(owner,{weekStart:'2026-11-02'})).some(x=>x.projectId===2),'later execution does not backfill earlier weeks');
    await db.query(`INSERT INTO project_closures(id,project_id,requester_id,approver_id,status,snapshot,reviewed_at)
      VALUES(1,3,1,1,'voided','{}','2026-11-04T02:00:00Z')`);
    await db.query(`INSERT INTO closure_reopens(closure_id,project_id,requester_id,approver_id,reason,status,reviewed_at)
      VALUES(1,3,1,1,'Resume execution','approved','2026-11-23T02:00:00Z')`);
    await db.query(`UPDATE projects SET status='active',closure_state='none',archived_at=NULL WHERE id=3`);
    now='2026-11-27T06:00:00Z';
    for (const inactiveWeek of ['2026-11-09','2026-11-16']) {
      assert.ok(!(await svc.list(owner,{weekStart:inactiveWeek})).some(x=>x.projectId===3),'reopening must not create reports for closed weeks');
    }
    assert.ok((await svc.list(owner,{weekStart:'2026-11-23'})).some(x=>x.projectId===3),'reopening week needs a report');
    assert.equal((await svc.detail(owner,3,'2026-11-02')).status,'submitted','closure-week report remains available');
    await svc.collect();
    assert.equal(Number((await db.query(`SELECT count(*) FROM project_weekly_reports WHERE project_id=3 AND week_start IN ('2026-11-09','2026-11-16')`))[0].count),0,'collector must not persist inactive-week obligations');
    // Exercise upgrade from the old reason-only request / approval-unlock workflow.
    const migration=new (require('../src/migrations/1802800000000-WeeklyReportProposedChanges').WeeklyReportProposedChanges1802800000000)();
    const runner=db.createQueryRunner();await runner.connect();
    try {
      await migration.down(runner);
      const [original]=await db.query("SELECT * FROM project_weekly_reports WHERE project_id=1 AND week_start='2026-11-02'");
      await db.query("INSERT INTO project_weekly_report_amendments(report_id,requester_id,approver_id,reason,status,original_report) VALUES($1,1,4,'Legacy unlocked','approved',$2::jsonb)",[original.id,JSON.stringify(original)]);
      await db.query("UPDATE project_weekly_reports SET status='draft',achievements='Unsaved legacy correction',submitted_at=NULL WHERE id=$1",[original.id]);
      const [other]=await db.query("SELECT * FROM project_weekly_reports WHERE project_id=3 AND week_start='2026-11-02'");
      await db.query("INSERT INTO project_weekly_report_amendments(report_id,requester_id,approver_id,reason,status,original_report) VALUES($1,1,4,'Legacy pending','pending',$2::jsonb)",[other.id,JSON.stringify(other)]);
      await migration.up(runner);
      const [restored]=await db.query('SELECT * FROM project_weekly_reports WHERE id=$1',[original.id]);
      assert.equal(restored.status,'submitted');assert.equal(restored.achievements,original.achievements);
      const [draft]=await db.query("SELECT * FROM project_weekly_report_amendments WHERE report_id=$1 AND status='draft'",[original.id]);
      assert.equal(draft.proposed_content.achievements,'Unsaved legacy correction');
      assert.equal(draft.original_report.version,restored.version);
      const [oldPending]=await db.query("SELECT * FROM project_weekly_report_amendments WHERE report_id=$1 ORDER BY id DESC LIMIT 1",[other.id]);
      assert.equal(oldPending.status,'rejected');
    } finally { await runner.release(); }
    // A designated co-owner alone can fill drafts; changing assignment does not rewrite submitted authors.
    await db.query('UPDATE projects SET weekly_report_owner_id=2 WHERE id=1');
    const historical=await svc.detail(coowner,1,'2026-11-02');
    assert.equal(historical.ownerId,1,'submitted report preserves the original author');
    const week='2026-11-23';
    assert.equal((await svc.detail(owner,1,week)).canEdit,false);
    assert.equal((await svc.detail(coowner,1,week)).canEdit,true);
    assert.ok((await svc.todo(coowner)).some(r=>r.projectId===1 && r.weekStart===week));
    assert.ok(!(await svc.todo(owner)).some(r=>r.projectId===1 && r.weekStart===week));
    assert.equal((await svc.notificationRows()).find(r=>r.projectId===1 && r.weekStart===week).ownerId,2);
    await assert.rejects(svc.save(owner,{...body,weekStart:week}),/负责人/);
    await svc.save(coowner,{...body,weekStart:week});
    await db.query('UPDATE projects SET weekly_report_owner_id=1 WHERE id=1');
    await assert.rejects(svc.save(coowner,{...body,weekStart:week,version:1}),/负责人/);
    await svc.save(owner,{...body,weekStart:week,version:1},true);
    // Calendar edits also exempt already-materialized obligations without deleting saved content.
    await db.query(`INSERT INTO holidays(date,kind) SELECT d::date,'holiday' FROM generate_series('2026-11-23'::date,'2026-11-27'::date,interval '1 day') d`);
    assert.equal((await svc.notificationRows()).filter(r=>r.weekStart===week).length,0);
    assert.equal((await svc.todo(owner)).filter(r=>r.weekStart===week).length,0);
    assert.equal((await svc.summaryForLeader(week)).total,0);
    assert.equal((await svc.detail(owner,1,week)).status,'submitted','submitted history is retained');
    const {ClosuresService}=require('../src/modules/closures/closures.service');
    const closure=Object.create(ClosuresService.prototype);closure.db=db;
    assert.ok(!(await closure.missingWeeklyReports(1,db.manager)).some(r=>r.weekStart===week),'holiday obligations cannot block closure');
    await db.query(`INSERT INTO holidays(date,kind) VALUES('2026-11-29','makeup')`);
    assert.ok((await svc.summaryForLeader(week)).total>0,'makeup Sunday restores a working week');
    now='2026-12-11T06:00:00Z';
    await db.query(`INSERT INTO holidays(date,kind) SELECT d::date,'holiday' FROM generate_series('2026-11-30'::date,'2026-12-11'::date,interval '1 day') d`);
    await svc.collect();
    assert.equal(Number((await db.query(`SELECT count(*) FROM project_weekly_reports WHERE week_start IN ('2026-11-30','2026-12-07')`))[0].count),0,'two full holiday weeks create no obligations');
    // Completion removes later obligations even if a previous collector already created them.
    now='2026-12-21T06:00:00Z';
    await svc.collect();
    await db.query(`UPDATE tasks SET status='done',completed_at='2026-12-15T10:00:00+08:00' WHERE project_id=1 AND status<>'cancelled'`);
    assert.ok(!(await svc.todo(owner)).some(r=>r.projectId===1 && r.weekStart==='2026-12-21'));
    assert.ok(!(await svc.notificationRows()).some(r=>r.projectId===1 && r.weekStart==='2026-12-21'));
    assert.ok(!(await svc.list(owner,{weekStart:'2026-12-21'})).some(r=>r.projectId===1));
    const requiredAfterCompletion=await closure.missingWeeklyReports(1,db.manager);
    assert.ok(!requiredAfterCompletion.some(r=>r.weekStart==='2026-12-21'),'stale empty obligations cannot block closure');
    assert.ok(requiredAfterCompletion.some(r=>r.weekStart==='2026-12-14'),'completion week remains required');
    assert.equal((await svc.detail(owner,1,'2026-11-02')).status,'submitted','completion preserves submitted history');
    console.log('project weekly report isolated PostgreSQL integration passed');
  } finally {
    if(db?.isInitialized) await db.destroy();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`); await control.destroy(); global.Date=RealDate;
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
