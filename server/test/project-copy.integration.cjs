// Local PostgreSQL only: isolated schema, no external messages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { AllEntities } = require('../src/entities');
const env = require('dotenv').parse(fs.readFileSync('.env'));
if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost')) throw Error('Local database only');
const options = { type: 'postgres', host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432), username: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE };
const schema = `project_copy_it_${process.pid}`;
const control = new DataSource(options);
let db;
async function main() {
  const { ProjectCopyService } = require('../src/modules/tasks/project-copy.service');
  await control.initialize();
  await control.query(`CREATE SCHEMA "${schema}"`);
  db = new DataSource({ ...options, schema, extra: { options: `-c search_path=${schema}` }, entities: AllEntities, migrations: [path.resolve('src/migrations/*.ts')] });
  await db.initialize();
  await db.runMigrations();
  process.env.FEISHU_BUSINESS_ROOT_DEPT = 'copy_root';
  await db.query("INSERT INTO departments(id,name,feishu_dept_id) VALUES(1,'复制测试','copy_root'),(2,'外部','outside')");
  await db.query("INSERT INTO users(id,name,feishu_user_id,dept_id) VALUES(1,'负责人','copy_owner',1),(2,'外部','copy_outside',2)");
  const [source] = await db.query("INSERT INTO projects(name,dept_id,created_by,status,plan_locked) VALUES('源项目',1,1,'archived',true) RETURNING *");
  const [parent] = await db.query("INSERT INTO tasks(project_id,title,creator_id,status,sort_order,assignee_id,start_at) VALUES($1,'阶段',1,'done',7,1,CURRENT_DATE) RETURNING *", [source.id]);
  await db.query("INSERT INTO tasks(project_id,parent_id,title,creator_id,status,sort_order,description,acceptor_id,due_at,completed_at) VALUES($1,$2,'子任务',1,'done',3,'不复制',1,CURRENT_DATE,NOW()),($1,NULL,'取消任务',1,'cancelled',9,NULL,NULL,NULL,NULL)", [source.id,parent.id]);
  await db.query("INSERT INTO task_assignees(task_id,user_id,role) VALUES($1,1,'assignee')", [parent.id]);
  await db.query("INSERT INTO task_logs(task_id,project_id,operator_id,action,payload) VALUES($1,$2,1,'transition','{}')", [parent.id,source.id]);
  await db.query("INSERT INTO task_assets(project_id,task_id,asset_type,title,uploader_id) VALUES($1,$2,'file','历史附件',1)", [source.id,parent.id]);
  await db.query("INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content) VALUES($1,$2,1,CURRENT_DATE,'历史进展')", [source.id,parent.id]);
  const actor = { userId: 1, roles: ['admin'], deptId: 1, managedDeptIds: [] };
  const input = { name: '独立项目', deptId: 1, ownerIds: [1], category: '未分类' };
  // Visibility is delegated to TasksService, and denial must prevent all writes.
  const denied = new ProjectCopyService(db, { getProject: async () => { const e = Error('not visible'); e.status = 403; throw e; } });
  await assert.rejects(denied.copy(actor, Number(source.id), input), { status: 403 });
  assert.equal((await db.query('SELECT count(*)::int n FROM projects'))[0].n, 1);
  const service = new ProjectCopyService(db, { getProject: async () => source });
  await assert.rejects(service.copy({ ...actor, readOnly: true }, Number(source.id), input), { status: 403 });
  await assert.rejects(service.copy(actor, Number(source.id), { ...input, ownerIds: [2] }), { status: 400 });
  await assert.rejects(service.copy(actor, Number(source.id), { ...input, deptId: 2 }), { status: 400 });
  await assert.rejects(service.copy({ ...actor, roles: ['member'], deptId: 2 }, Number(source.id), input), { status: 403 });
  const locker = db.createQueryRunner();
  await locker.connect(); await locker.startTransaction();
  try {
    await locker.query('SELECT pg_advisory_xact_lock(21017,hashtext($1))', [String(source.id)]);
    await assert.rejects(service.copy(actor, Number(source.id), input), { status: 409 });
  } finally { await locker.rollbackTransaction(); await locker.release(); }
  const result = await service.copy(actor, Number(source.id), input);
  assert.notEqual(String(result.id), String(source.id));
  assert.equal(String(result.sourceProjectId), String(source.id));
  assert.ok(result.sourceCopiedAt);
  const [project] = await db.query('SELECT * FROM projects WHERE id=$1', [result.id]);
  assert.equal(project.status, 'active'); assert.equal(project.plan_locked, false); assert.equal(project.start_at, null);
  const rows = await db.query('SELECT * FROM tasks WHERE project_id=$1 ORDER BY id', [result.id]);
  assert.equal(rows.length, 2);
  const root = rows.find(t => t.title === '阶段'); const child = rows.find(t => t.title === '子任务');
  assert.equal(child.parent_id, root.id); assert.equal(root.sort_order, 7); assert.equal(child.sort_order, 3);
  for (const row of rows) {
    assert.notEqual(row.id, parent.id); assert.equal(row.status, 'todo');
    for (const field of ['assignee_id','acceptor_id','start_at','due_at','completed_at','description']) assert.equal(row[field], null);
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM task_assignees WHERE task_id=ANY($1::bigint[])', [rows.map(t=>t.id)]))[0].n, 0);
  for (const table of ['task_assets','task_daily_updates','plan_changes']) {
    assert.equal((await db.query(`SELECT count(*)::int n FROM ${table} WHERE project_id=$1`, [result.id]))[0].n, 0);
  }
  const logs = await db.query('SELECT * FROM task_logs WHERE project_id=$1', [result.id]);
  assert.equal(logs.length, 1); assert.equal(String(logs[0].payload.sourceProjectId), source.id);
  assert.deepEqual(await db.query('SELECT * FROM projects WHERE id=$1', [source.id]), [source]);
  // Fail the last write: project, owners and all tasks must roll back together.
  await db.query("ALTER TABLE task_logs ADD CONSTRAINT reject_copy_test CHECK (action <> 'project_copy') NOT VALID");
  await assert.rejects(service.copy(actor, Number(source.id), input), /reject_copy_test/);
  assert.equal((await db.query('SELECT count(*)::int n FROM projects'))[0].n, 2);
  assert.equal((await db.query('SELECT count(*)::int n FROM project_owners'))[0].n, 1);
  assert.equal((await db.query('SELECT count(*)::int n FROM tasks'))[0].n, 5);
  await db.query('ALTER TABLE task_logs DROP CONSTRAINT reject_copy_test');
  await db.query("UPDATE projects SET status='terminated' WHERE id=$1", [source.id]);
  const fromTerminated = await service.copy(actor, Number(source.id), input);
  assert.equal(fromTerminated.status, 'active'); assert.equal(fromTerminated.taskCount, 2);
  console.log('PASS project copy: visibility, business scope, independent hierarchy, reset fields, provenance and atomic rollback');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
  if(db?.isInitialized) await db.destroy();
  if(control.isInitialized) { await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await control.destroy(); }
});
