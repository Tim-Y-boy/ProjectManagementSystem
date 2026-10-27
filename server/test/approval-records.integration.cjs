// Local PostgreSQL, isolated schema only; no business data mutations or notifications.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const env = require('dotenv').parse(fs.readFileSync('.env'));
if (!['localhost','127.0.0.1','::1'].includes(env.DB_HOST || 'localhost')) throw Error('Local database only');
const { DataSource } = require('typeorm');
const E = require('../src/entities');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const options = { type:'postgres', host:env.DB_HOST || 'localhost', port:Number(env.DB_PORT || 5432), username:env.DB_USERNAME, password:env.DB_PASSWORD, database:env.DB_DATABASE, logging:false };
const schema = `approval_it_${process.pid}`;
const control = new DataSource(options);
let db, created = false;
const member = userId => ({ userId, roles:['member'], managedDeptIds:[] });
async function main() {
  await control.initialize(); await control.query(`CREATE SCHEMA "${schema}"`); created=true;
  db = new DataSource({ ...options, schema, extra:{ options:`-c search_path=${schema}` }, entities:E.AllEntities, migrations:[path.resolve('src/migrations/*.ts')] });
  await db.initialize(); await db.runMigrations();
  await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES (1,'负责人','approval_owner'),(2,'审批人','approval_reviewer'),(3,'执行人','approval_executor'),(4,'无关人','approval_outsider'),(5,'历史执行人','approval_previous')`);
  await db.query(`INSERT INTO projects(id,name,created_by,owner_id) VALUES (1,'测试项目',1,1),(2,'其他项目',4,4)`);
  await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,acceptor_id,status) VALUES (1,1,'已取消任务',1,3,2,'cancelled'),(2,1,'多轮验收',1,3,2,'doing')`);
  await db.query(`INSERT INTO plan_changes(id,project_id,reason,requester_id,approver_id,status,reviewed_at) VALUES (1,1,'取消原因',1,2,'approved',now())`);
  await db.query(`INSERT INTO plan_change_items(change_id,task_id,change_type,before,after) VALUES (1,1,'delete','{"assigneeIds":[3,5]}','{}')`);
  await db.query(`INSERT INTO task_logs(id,task_id,project_id,operator_id,action,from_status,to_status,created_at) VALUES
    (1,2,1,3,'transition','doing','pending_accept','2026-10-20 10:00Z'),
    (2,2,1,2,'transition','pending_accept','doing','2026-10-20 11:00Z'),
    (3,2,1,3,'transition','doing','pending_accept','2026-10-21 10:00Z'),
    (4,2,1,2,'transition','pending_accept','done','2026-10-21 11:00Z'),
    (5,2,1,2,'transition','done','doing','2026-10-22 10:00Z')`);
  const service = Object.create(TasksService.prototype);
  for (const [key, entity] of Object.entries({ tasks:E.Task, logs:E.TaskLog, users:E.User, projects:E.Project, projectOwners:E.ProjectOwner, planChanges:E.PlanChange, planChangeItems:E.PlanChangeItem, assignees:E.TaskAssignee })) service[key] = db.getRepository(entity);
  const related = await service.approvalRecords(member(3),'related');
  assert.ok(related.some(r=>r.key==='change-1'), 'cancelled task remains visible');
  assert.ok(!(await service.approvalRecords(member(3),'mine')).some(r=>r.key==='change-1'));
  assert.ok((await service.approvalRecords(member(5),'related')).some(r=>r.key==='change-1'), 'snapshot participant remains visible');
  assert.equal((await service.approvalRecords(member(4),'related')).length,0,'unrelated user excluded');
  assert.ok((await service.approvalRecords(member(1),'related')).some(r=>r.key==='change-1'),'owner sees project approvals');
  assert.ok((await service.approvalRecords(member(2),'history')).some(r=>r.key==='change-1'),'actual reviewer history');
  assert.equal(related.find(r=>r.key==='task-log-1').status,'rejected');
  assert.equal(related.find(r=>r.key==='task-log-3').status,'approved','later task reopen does not rewrite approval');
  assert.match(related.find(r=>r.key==='task-log-3').path,/taskLogId=3/);
  const detail = await service.taskApprovalDetail(member(3),undefined,3);
  assert.equal(detail.submitted.operatorName,'执行人'); assert.equal(detail.decision.operatorName,'审批人');
  assert.equal(detail.status,'approved'); assert.equal(detail.canReview,false);
  for (const [userId, view, key] of [[3,'mine','task-log-3'],[3,'related','task-log-3'],[2,'history','task-log-4']]) {
    const record=(await service.approvalRecords(member(userId),view)).find(r=>r.key===key);
    assert.equal(new Date(record.requestedAt).toISOString(),new Date(detail.submitted.createdAt).toISOString(),'list submission time matches detail in every view');
    assert.equal(new Date(record.reviewedAt).toISOString(),new Date(detail.decision.createdAt).toISOString(),'list approval time matches detail in every view');
    assert.notEqual(new Date(record.requestedAt).getTime(),new Date(record.reviewedAt).getTime());
  }
  const rejected=related.find(r=>r.key==='task-log-1');
  assert.equal(new Date(rejected.reviewedAt).toISOString(),'2026-10-20T11:00:00.000Z');
  const change=related.find(r=>r.key==='change-1');
  assert.equal(change.requesterName,'负责人');assert.equal(change.approverName,'审批人');
  assert.ok(change.requestedAt && change.reviewedAt);
  await assert.rejects(()=>service.taskApprovalDetail(member(4),undefined,3),/无权/);
  await assert.rejects(()=>service.getPlanChange(member(4),1),/无权/);
  assert.equal((await service.getPlanChange(member(3),1)).reason,'取消原因');
  await db.query(`UPDATE tasks SET status='pending_accept' WHERE id=2`);
  await db.query(`INSERT INTO task_logs(id,task_id,project_id,operator_id,action,from_status,to_status,created_at) VALUES (6,2,1,3,'transition','doing','pending_accept','2026-10-23 10:00Z')`);
  assert.equal((await service.taskApprovalDetail(member(3),2)).canReview,false,'executor can read but cannot approve');
  assert.equal((await service.taskApprovalDetail(member(2),2)).canReview,true,'designated acceptor can approve current round');
  assert.equal((await service.taskApprovalDetail(member(2),undefined,3)).canReview,false,'old round cannot approve new round');
  const oldMessage=await service.taskApprovalDetail(member(3),2,undefined,'accept','2026-10-20T11:00:00Z');
  assert.equal(oldMessage.status,'rejected');assert.equal(String(oldMessage.submitted.id),'1','message timestamp preserves original cycle');
  await assert.rejects(()=>service.taskApprovalDetail(member(3),NaN),/编号无效/);
  console.log('PostgreSQL approval integration passed: related scope, cancellation, snapshot participant, owner, reviewer, cycle status, immutable links, unauthorized detail access.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{ if(db?.isInitialized)await db.destroy();if(created)await control.query(`DROP SCHEMA "${schema}" CASCADE`);if(control.isInitialized)await control.destroy(); });
