// Local database, isolated schema; no business data or notifications are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { AllEntities } = require('../src/entities');
const { Project } = require('../src/entities/project.entity');
const { Task } = require('../src/entities/task.entity');
const { TaskLog } = require('../src/entities/task-log.entity');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost','127.0.0.1','::1'].includes(env.DB_HOST || 'localhost'));
const options = { type:'postgres', host:env.DB_HOST || 'localhost', port:Number(env.DB_PORT || 5432), username:env.DB_USERNAME, password:env.DB_PASSWORD, database:env.DB_DATABASE };
const schema = `deleted_project_logs_it_${process.pid}`;
const control = new DataSource(options);
let db;
async function main() {
  await control.initialize();
  await control.query(`CREATE SCHEMA "${schema}"`);
  try {
    db = new DataSource({...options, schema, extra:{options:`-c search_path=${schema}`}, entities:AllEntities, migrations:[path.resolve('src/migrations/*.ts')]});
    await db.initialize(); await db.runMigrations();
    await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(1,'测试管理员','audit_test')`);
    const service = Object.create(TasksService.prototype);
    service.projects=db.getRepository(Project); service.tasks=db.getRepository(Task); service.logs=db.getRepository(TaskLog);
    service.withLogOperators=async logs=>logs;
    const admin={userId:1,roles:['admin']};
    await assert.rejects(service.listOperationLogProjects({userId:2,roles:[]}), /无权/);
    const [p]=await db.query(`INSERT INTO projects(name,created_by,plan_locked) VALUES('待删除项目',1,false) RETURNING id`);
    const [t]=await db.query(`INSERT INTO tasks(project_id,title,creator_id,status) VALUES($1,'保留名称的任务',1,'todo') RETURNING id`,[p.id]);
    await db.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,payload) VALUES($1,$2,1,'create','{"reason":"原始信息"}')`,[t.id,p.id]);
    assert.equal((await service.listOperationLogProjects(admin))[0].deleted,false);
    // Failed deletion must roll back the snapshots and deletion record as well.
    await db.query(`ALTER TABLE task_logs ADD CONSTRAINT reject_delete CHECK(action <> 'project_delete') NOT VALID`);
    await assert.rejects(service.deleteProject(admin,Number(p.id)));
    assert.equal(await service.projects.count(),1);
    assert.equal(await service.logs.count(),1);
    await db.query(`ALTER TABLE task_logs DROP CONSTRAINT reject_delete`);
    await service.deleteProject(admin,Number(p.id));
    assert.equal(await service.projects.count(),0);
    assert.equal(await service.tasks.count(),0);
    const choices=await service.listOperationLogProjects(admin);
    assert.equal(choices[0].name,'待删除项目'); assert.equal(choices[0].deleted,true);
    const result=await service.listOperationLogs(admin,{projectId:Number(p.id)});
    assert.equal(result.total,2);
    const original=result.items.find(l=>l.action==='create');
    assert.equal(original.projectName,'待删除项目'); assert.equal(original.taskTitle,'保留名称的任务');
    assert.equal(original.payload.reason,'原始信息');
    assert.equal(Number(result.items.find(l=>l.action==='project_delete').operatorId),1);
    const [empty]=await db.query(`INSERT INTO projects(name,created_by,plan_locked) VALUES('无任务项目',1,false) RETURNING id`);
    await service.deleteProject(admin,Number(empty.id));
    assert.ok((await service.listOperationLogProjects(admin)).some(p=>p.name==='无任务项目' && p.deleted));
    console.log('PASS: deleted project logs, names, empty projects, permissions and transaction rollback');
  } finally {
    if(db?.isInitialized) await db.destroy();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`); await control.destroy();
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
