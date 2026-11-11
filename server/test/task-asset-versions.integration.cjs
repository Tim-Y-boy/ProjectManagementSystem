// Local PostgreSQL only; an isolated schema is created and removed. No notifications are sent.
// Run: node -r ts-node/register/transpile-only test/task-asset-versions.integration.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { AllEntities } = require('../src/entities');
const { Task } = require('../src/entities/task.entity');
const { TaskDailyUpdate } = require('../src/entities/task-daily-update.entity');
const { TaskAsset } = require('../src/entities/task-asset.entity');
const { TaskLog } = require('../src/entities/task-log.entity');
const { Project } = require('../src/entities/project.entity');
const { User } = require('../src/entities/user.entity');
const { ProjectOwner } = require('../src/entities/project-owner.entity');
const { TaskAssignee } = require('../src/entities/task-assignee.entity');
const { Category } = require('../src/entities/category.entity');
const { TasksService } = require('../src/modules/tasks/tasks.service');
const { TasksController } = require('../src/modules/tasks/tasks.controller');
const { ProjectFreezeInterceptor } = require('../src/modules/closures/project-freeze.interceptor');
const { JwtAuthGuard } = require('../src/modules/auth/jwt-auth.guard');
const { RolesGuard } = require('../src/common/roles.guard');
const { JwtService } = require('@nestjs/jwt');
const { ClosuresService } = require('../src/modules/closures/closures.service');
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const env = require('dotenv').parse(fs.readFileSync('.env'));
if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost')) throw Error('Local database only');
const options = { type: 'postgres', host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
  username: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE, logging: false };
const schema = `asset_versions_it_${process.pid}`;
if (!/^asset_versions_it_\d+$/.test(schema)) throw Error('Invalid test schema');
const control = new DataSource(options);
let db, app, created = false;
const files = [];
const upload = name => {
  const dir = path.resolve('uploads/task-assets'); fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, `progress-integration-${process.pid}-${files.length}`);
  fs.writeFileSync(filename, 'test'); files.push(filename);
  return { path: filename, originalname: name, mimetype: 'text/plain', size: 4 };
};
async function main() {
  await control.initialize(); await control.query(`CREATE SCHEMA "${schema}"`); created = true;
  db = new DataSource({ ...options, schema, extra: { options: `-c search_path=${schema} -c lock_timeout=2000` }, entities: AllEntities,
    migrations: [path.resolve('src/migrations/*.ts')] });
  await db.initialize(); await db.runMigrations();
  await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(1,'隔离测试执行人','progress_save_test')`);
  const [project] = await db.query(`INSERT INTO projects(name,created_by,plan_locked) VALUES('进展事务测试',1,true) RETURNING id`);
  const [task] = await db.query(`INSERT INTO tasks(project_id,title,creator_id,status) VALUES($1,'测试任务',1,'doing') RETURNING id`, [project.id]);
  // Re-run only the new migration against legacy rows in this disposable schema.
  await db.undoLastMigration();
  const legacyFile = upload('legacy.txt');
  const legacy = await db.query(`INSERT INTO task_assets(project_id,task_id,asset_type,title,file_path,original_name,uploader_id,created_at)
    VALUES($1,$2,'upload','legacy',$3,'legacy.txt',1,'2025-01-02T03:04:05Z'),
    ($1,$2,'upload','legacy duplicate',$3,'legacy.txt',1,'2025-01-02T03:04:05Z') RETURNING id`, [project.id,task.id,legacyFile.path]);
  await db.runMigrations();
  const migrated = await db.query(`SELECT a.id,v.version_no,v.file_path,v.uploader_id,v.created_at FROM task_assets a
    JOIN task_asset_versions v ON v.id=a.current_version_id WHERE a.id=ANY($1::bigint[]) ORDER BY a.id`, [legacy.map(r=>r.id)]);
  assert.equal(migrated.length, 2, 'migration must preserve same-name legacy identities');
  assert.ok(migrated.every(v=>v.version_no === 1 && v.file_path === legacyFile.path && Number(v.uploader_id) === 1));
  assert.equal(migrated[0].created_at.toISOString(), '2025-01-02T03:04:05.000Z');
  const service = Object.create(TasksService.prototype);
  for (const [name, entity] of Object.entries({ tasks: Task, dailyUpdates: TaskDailyUpdate, assets: TaskAsset, logs: TaskLog, projects: Project,
    users: User, projectOwners: ProjectOwner, assignees: TaskAssignee, categories: Category })) {
    service[name] = db.getRepository(entity);
  }
  service.logger = { error: message => { throw Error(message); } };
  const admin = { userId: 1, roles: ['admin'], managedDeptIds: [] };
  const payload = { workDate: '2026-10-08', content: '隔离数据库验证' };
  const legacyProgress = await service.saveProgress(admin,Number(task.id),{...payload,noMaterialReason:'initial'},[]);
  const legacyUpload = await service.uploadTaskAsset(admin,Number(task.id),upload('legacy-new.txt'),{dailyUpdateId:legacyProgress.id,title:'Custom upload title',description:'Upload notes'});
  assert.equal(legacyUpload.title,'Custom upload title');
  assert.equal(legacyUpload.description,'Upload notes');
  assert.ok(legacyUpload.currentVersionId);
  const legacyLink = await service.createTaskAsset(admin,Number(task.id),{dailyUpdateId:legacyProgress.id,title:'Custom link',url:'https://example.com',description:'Link notes',fileSize:123});
  assert.equal(legacyLink.title,'Custom link');
  assert.equal(legacyLink.description,'Link notes');
  assert.equal(Number(legacyLink.fileSize),123);

  const a = await service.saveProgress(admin, Number(task.id), payload, [upload('Proof.txt')]);
  const [asset] = await service.assets.find({ where: { dailyUpdateId: a.id } });
  assert.ok(asset.currentVersionId, 'every upload must create immutable v1');
  const [other] = await db.query(`INSERT INTO tasks(project_id,title,creator_id,status) VALUES($1,'B',1,'doing') RETURNING id`, [project.id]);
  const b = await service.saveProgress(admin, Number(other.id), {...payload,existingAssetIds:[asset.id]}, []);
  assert.equal((await service.listTaskAssets(admin, Number(other.id)))[0].id, asset.id);
  assert.equal((await service.listDailyUpdates(admin,Number(other.id)))[0].assets[0].currentVersionId,asset.currentVersionId);
  const member = { userId: 2, roles: ['member'], managedDeptIds: [] };
  await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(2,'B member','asset_member')`);
  await db.query(`INSERT INTO task_assignees(task_id,user_id,role) VALUES($1,2,'assignee')`,[other.id]);
  await assert.rejects(service.updateTaskAssetVersion(member,Number(other.id),Number(asset.id),upload('proof.txt'),{expectedVersionId:asset.currentVersionId,reason:'cannot update source'}),/无权维护/);
  await assert.rejects(service.saveProgress(admin, Number(other.id), payload, [upload(' proof.TXT ')]), /重名/);
  await assert.rejects(service.saveProgress(admin, Number(other.id), payload, [upload('batch.txt'),upload('BATCH.TXT')]), /重名/);
  const v2 = await service.updateTaskAssetVersion(admin, Number(other.id), Number(asset.id), upload('proof.txt'), {expectedVersionId:asset.currentVersionId});
  assert.equal(v2.versionNo, 2);
  assert.notEqual(v2.currentVersionId, asset.currentVersionId);
  assert.equal((await service.listTaskAssets(admin, Number(other.id)))[0].currentVersionId, v2.currentVersionId);
  const history = await service.listTaskAssetVersions(admin, Number(other.id), Number(asset.id));
  assert.deepEqual(history.versions.map(v=>v.versionNo), [2,1]);
  assert.ok(history.versions.every(v=>v.fileAvailable === true));
  assert.equal(history.affectedTasks.length, 2);
  assert.equal(await service.logs.count({where:{action:'task_asset_update'}}), 2);
  for(const version of history.versions) {
    const downloaded = await service.getTaskAssetVersionDownload(admin, Number(other.id), Number(asset.id), Number(version.id));
    downloaded.stream.destroy(); assert.equal(downloaded.asset.originalName, version.originalName);
  }
  await db.query(`UPDATE task_asset_versions SET file_path=$1 WHERE id=$2`,[path.resolve('package.json'),asset.currentVersionId]);
  await assert.rejects(service.getTaskAssetVersionDownload(admin,Number(task.id),Number(asset.id),Number(asset.currentVersionId)),/文件不存在/);
  assert.equal((await service.listTaskAssetVersions(admin, Number(task.id), Number(asset.id))).versions.find(v=>String(v.id)===String(asset.currentVersionId)).fileAvailable, false);
  await db.query(`UPDATE task_asset_versions SET file_path=$1 WHERE id=$2`,['uploads/task-assets/missing-history-fixture',asset.currentVersionId]);
  assert.equal((await service.listTaskAssetVersions(admin, Number(task.id), Number(asset.id))).versions.find(v=>String(v.id)===String(asset.currentVersionId)).fileAvailable, false);
  await db.query(`UPDATE task_asset_versions SET file_path=$1 WHERE id=$2`,[history.versions[1].filePath,asset.currentVersionId]);
  await assert.rejects(service.updateTaskAssetVersion(admin, Number(task.id), Number(asset.id), upload('proof.txt'), {expectedVersionId:asset.currentVersionId,reason:'stale'}), /版本已更新/);
  await assert.rejects(service.updateTaskAssetVersion({...admin,readOnly:true}, Number(task.id), Number(asset.id), upload('proof.txt'), {expectedVersionId:v2.currentVersionId,reason:'visitor'}), /仅可读取/);
  assert.equal((await service.listTaskAssetVersions({...admin,readOnly:true}, Number(task.id), Number(asset.id))).canUpdate,false);
  for (const state of ['pending','closed']) {
    await db.query(`UPDATE projects SET closure_state=$1 WHERE id=$2`, [state,project.id]);
    await assert.rejects(service.updateTaskAssetVersion(admin, Number(task.id), Number(asset.id), upload('proof.txt'), {expectedVersionId:v2.currentVersionId,reason:'closed'}), /结项/);
  }
  await db.query(`UPDATE projects SET closure_state='none' WHERE id=$1`, [project.id]);
  await db.query(`UPDATE tasks SET status='pending_accept' WHERE id=$1`, [other.id]);
  await assert.rejects(service.updateTaskAssetVersion(admin, Number(task.id), Number(asset.id), upload('proof.txt'), {expectedVersionId:v2.currentVersionId,reason:'blocked'}), /验收/);
  assert.equal((await service.listProjectAssets(admin, Number(task.id))).find(a=>a.id===asset.id).canUpdate,false);
  await db.query(`UPDATE tasks SET status='doing' WHERE id=$1`, [other.id]);
  await assert.rejects(service.unlinkTaskAsset(admin,Number(other.id),Number(b.id),Number(asset.id)),/最后一份/);
  await service.updateDailyUpdate(admin, Number(other.id), Number(b.id), {...payload,noMaterialReason:'Archived offline'});
  await service.unlinkTaskAsset(admin, Number(other.id), Number(b.id), Number(asset.id));
  assert.equal((await service.listTaskAssets(admin, Number(other.id))).length, 0);
  await assert.rejects(service.deleteTaskAsset(admin, Number(task.id), Number(asset.id)), /历史版本/);
  await db.query(`ALTER TABLE task_logs ADD CONSTRAINT reject_version_log CHECK(action <> 'task_asset_update') NOT VALID`);
  const failed = upload('rename.txt');
  await assert.rejects(service.updateTaskAssetVersion(admin, Number(task.id), Number(asset.id), failed, {expectedVersionId:v2.currentVersionId,reason:'rollback'}), /reject_version_log/);
  assert.equal(fs.existsSync(failed.path), false);
  assert.equal((await service.listTaskAssetVersions(admin, Number(task.id), Number(asset.id))).versions.length, 2);
  await db.query(`ALTER TABLE task_logs DROP CONSTRAINT reject_version_log`);
  const race = await Promise.allSettled([1,2].map(n=>service.updateTaskAssetVersion(admin,Number(task.id),Number(asset.id),upload('proof.txt'),{expectedVersionId:v2.currentVersionId,reason:'Concurrent '+n})));
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await service.listTaskAssetVersions(admin, Number(task.id), Number(asset.id))).versions.length,3);
  await service.saveProgress(admin,Number(other.id),{updateId:b.id,materialsOnly:true,existingAssetIds:[asset.id]},[]);
  service.weeklyProgress = {missingWeeksForTask:async()=>[]};
  const preAcceptance = await service.assets.findOneByOrFail({id:asset.id});
  const acceptanceRace = await Promise.allSettled([
    service.transition(admin,Number(other.id),'pending_accept'),
    service.updateTaskAssetVersion(admin,Number(task.id),Number(asset.id),upload('proof.txt'),{expectedVersionId:preAcceptance.currentVersionId,reason:'Race with acceptance'}),
  ]);
  assert.equal(acceptanceRace[0].status,'fulfilled');
  if(acceptanceRace[1].status==='rejected') assert.match(acceptanceRace[1].reason.message,/验收/);
  assert.equal((await service.tasks.findOneByOrFail({id:other.id})).status,'pending_accept');
  await assert.rejects(service.updateTaskAssetVersion(admin,Number(task.id),Number(asset.id),upload('proof.txt'),{expectedVersionId:(await service.assets.findOneByOrFail({id:asset.id})).currentVersionId,reason:'After acceptance'}),/验收/);
  const [foreignProject] = await db.query(`INSERT INTO projects(name,created_by,plan_locked) VALUES('foreign',1,true) RETURNING id`);
  const [foreignTask] = await db.query(`INSERT INTO tasks(project_id,title,creator_id,status) VALUES($1,'foreign',1,'doing') RETURNING id`,[foreignProject.id]);
  await assert.rejects(service.saveProgress(admin,Number(foreignTask.id),{...payload,existingAssetIds:[asset.id]},[]),/不属于当前项目/);
  await assert.rejects(service.getTaskAssetDownload(admin,Number(foreignTask.id),Number(asset.id)),/资料不存在/);
  await assert.rejects(service.getTaskAssetVersionDownload(admin,Number(foreignTask.id),Number(asset.id),Number(asset.currentVersionId)),/资料不存在/);
  await service.saveProgress(admin,Number(foreignTask.id),payload,[upload('proof.txt')]);
  const orphan = await service.uploadTaskAsset(admin,Number(task.id),upload('orphan.txt'),{dailyUpdateId:legacyProgress.id});
  await db.query(`UPDATE task_assets SET task_id=NULL,daily_update_id=NULL,linked_daily_update_ids='[]' WHERE id=$1`,[orphan.id]);
  await service.updateTaskAssetVersion(admin,Number(task.id),Number(orphan.id),upload('orphan.txt'),{expectedVersionId:orphan.currentVersionId,reason:'Orphan source update'});
  const orphanLogs = (await service.logs.find({where:{action:'task_asset_update'}})).filter(l=>String(l.payload.assetId)===String(orphan.id));
  assert.equal(orphanLogs.length,1,'project-only asset update must retain an audit event');
  assert.deepEqual(orphanLogs[0].payload.affectedTasks,[]);
  const removedSourceAsset = await service.uploadTaskAsset(admin,Number(task.id),upload('cancelled-source.txt'),{dailyUpdateId:legacyProgress.id});
  await db.query(`UPDATE tasks SET status='doing' WHERE id=$1`,[other.id]);
  await service.saveProgress(admin,Number(other.id),{updateId:b.id,materialsOnly:true,existingAssetIds:[removedSourceAsset.id]},[]);
  await db.query(`UPDATE tasks SET status='cancelled' WHERE id=$1`,[task.id]);
  await assert.rejects(service.updateTaskAssetVersion(member,Number(other.id),Number(removedSourceAsset.id),upload('cancelled-source.txt'),{expectedVersionId:removedSourceAsset.currentVersionId,reason:'old source participant'}),/仅项目管理者/);
  const restoredSource = await service.updateTaskAssetVersion(admin,Number(other.id),Number(removedSourceAsset.id),upload('cancelled-source.txt'),{expectedVersionId:removedSourceAsset.currentVersionId,reason:'manager maintains removed source'});
  assert.equal(restoredSource.versionNo,2);
  const removedHistory = await service.listTaskAssetVersions(admin,Number(other.id),Number(removedSourceAsset.id));
  assert.equal(removedHistory.affectedTasks.length,2,'keep cancelled source attribution');
  await db.query(`UPDATE tasks SET status='doing' WHERE id=$1`,[task.id]);
  // Exercise the real controller + multipart interceptor + project freeze session lock.
  // A separate transaction connection would deadlock against the interceptor's lock.
  const jwt = new JwtService({secret:'isolated-version-http-test'});
  const headers = {authorization:'Bearer '+jwt.sign({...admin,feishuUserId:'progress_save_test'})};
  class HttpTestModule {}
  Module({ controllers:[TasksController], providers:[
    {provide:TasksService,useValue:service}, {provide:DataSource,useValue:db},
    {provide:JwtService,useValue:jwt}, {provide:ClosuresService,useValue:{observeProject:async()=>{}}},
    ProjectFreezeInterceptor, JwtAuthGuard, RolesGuard,
  ] })(HttpTestModule);
  app = await NestFactory.create(HttpTestModule,{logger:false,abortOnError:false});
  await app.listen(0,'127.0.0.1');
  const base = await app.getUrl();
  const multipart = new FormData();
  multipart.set('payload',JSON.stringify(payload));
  multipart.append('files',new Blob(['http proof']), 'http-proof.txt');
  const response = await fetch(`${base}/tasks/${task.id}/progress-save`,{method:'POST',headers,body:multipart,signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,201,await response.text());
  const httpAsset = await service.assets.findOneByOrFail({taskId:task.id,originalName:'http-proof.txt'});
  files.push(httpAsset.filePath);
  const updateForm = new FormData();
  updateForm.set('expectedVersionId',String(httpAsset.currentVersionId));updateForm.set('reason','HTTP update');
  updateForm.append('file',new Blob(['http v2']), 'http-proof.txt');
  const updateResponse = await fetch(`${base}/tasks/${task.id}/assets/${httpAsset.id}/versions`,{method:'POST',headers,body:updateForm,signal:AbortSignal.timeout(5000)});
  assert.equal(updateResponse.status,201,await updateResponse.text());
  const httpUpdated = await service.assets.findOneByOrFail({id:httpAsset.id});files.push(httpUpdated.filePath);
  assert.notEqual(httpUpdated.currentVersionId,httpAsset.currentVersionId);
  await db.query(`UPDATE projects SET closure_state='pending' WHERE id=$1`,[project.id]);
  const frozenResponse = await fetch(`${base}/tasks/${task.id}/assets/${httpAsset.id}`,{method:'DELETE',headers,signal:AbortSignal.timeout(5000)});
  assert.equal(frozenResponse.status,400,'interceptor must retain project freeze guard');
  await db.query(`UPDATE projects SET closure_state='none' WHERE id=$1`,[project.id]);
  await app.close();app=null;
  // Explicit replacement must work even when migrated files share a name.
  const original = await service.assets.findOneByOrFail({id:legacy[0].id});
  const untouched = await service.assets.findOneByOrFail({id:legacy[1].id});
  const replaced = await service.updateTaskAssetVersion(admin,Number(task.id),Number(original.id),upload('legacy.txt'),{expectedVersionId:original.currentVersionId});
  assert.equal(replaced.versionNo,2);
  assert.equal((await service.assets.findOneByOrFail({id:untouched.id})).currentVersionId,untouched.currentVersionId);
  assert.equal(fs.existsSync(legacyFile.path),true);
  // Updating with a different name also targets this identity, not another same-name file.
  const renamed = await service.updateTaskAssetVersion(admin,Number(task.id),Number(original.id),upload('Proof.txt'),{expectedVersionId:replaced.currentVersionId});
  assert.equal(renamed.versionNo,3);
  await assert.rejects(service.saveProgress(admin,Number(task.id),payload,[upload('legacy.txt')]),/重名/);
  await assert.rejects(service.uploadTaskAsset(admin,Number(task.id),upload('Proof.txt'),{dailyUpdateId:legacyProgress.id}),/重名/);
  console.log('Task asset versions integration passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if(app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  if (control.isInitialized) await control.destroy();
  for (const filename of files) if (fs.existsSync(filename)) fs.unlinkSync(filename);
});
