// Local PostgreSQL only; an isolated schema is created and removed. No notifications are sent.
// Run: node -r ts-node/register/transpile-only test/progress-save.integration.cjs
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
const { TasksService } = require('../src/modules/tasks/tasks.service');
const env = require('dotenv').parse(fs.readFileSync('.env'));
if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost')) throw Error('Local database only');
const options = { type: 'postgres', host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
  username: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE, logging: false };
const schema = `progress_save_it_${process.pid}`;
if (!/^progress_save_it_\d+$/.test(schema)) throw Error('Invalid test schema');
const control = new DataSource(options);
let db, created = false;
const files = [];
const upload = name => {
  const dir = path.resolve('uploads/task-assets'); fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, `progress-integration-${process.pid}-${files.length}`);
  fs.writeFileSync(filename, 'test'); files.push(filename);
  return { path: filename, originalname: name, mimetype: 'text/plain', size: 4 };
};
async function main() {
  await control.initialize(); await control.query(`CREATE SCHEMA "${schema}"`); created = true;
  db = new DataSource({ ...options, schema, extra: { options: `-c search_path=${schema}` }, entities: AllEntities,
    migrations: [path.resolve('src/migrations/*.ts')] });
  await db.initialize(); await db.runMigrations();
  await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(1,'隔离测试执行人','progress_save_test')`);
  const [project] = await db.query(`INSERT INTO projects(name,created_by,plan_locked) VALUES('进展事务测试',1,true) RETURNING id`);
  const [task] = await db.query(`INSERT INTO tasks(project_id,title,creator_id,status) VALUES($1,'测试任务',1,'doing') RETURNING id`, [project.id]);
  const service = Object.create(TasksService.prototype);
  for (const [name, entity] of Object.entries({ tasks: Task, dailyUpdates: TaskDailyUpdate, assets: TaskAsset, logs: TaskLog, projects: Project })) {
    service[name] = db.getRepository(entity);
  }
  service.logger = { error: message => { throw Error(message); } };
  const admin = { userId: 1, roles: ['admin'], managedDeptIds: [] };
  const payload = { workDate: '2026-10-08', content: '隔离数据库验证' };
  const reasonRow = await service.saveProgress(admin, Number(task.id), { ...payload, noMaterialReason: '现场口头确认' }, []);
  assert.equal(reasonRow.noMaterialReason, '现场口头确认');
  const successfulFile = upload('proof.txt');
  const materialRow = await service.saveProgress(admin, Number(task.id), { ...payload, links: [{ url: 'https://example.com/result' }] }, [successfulFile]);
  const assets = await service.assets.find({ where: { dailyUpdateId: materialRow.id } });
  assert.equal(assets.length, 2);
  assert.equal(await service.logs.count(), 4);
  await assert.rejects(service.createDailyUpdate(admin, Number(task.id), payload), /资料|原因/);
  await assert.rejects(service.updateDailyUpdate(admin, Number(task.id), Number(reasonRow.id), payload), /资料|原因/);
  const before = { updates: await service.dailyUpdates.count(), assets: await service.assets.count(), logs: await service.logs.count() };
  await db.query(`ALTER TABLE task_assets ADD CONSTRAINT reject_integration_file CHECK(title <> 'reject.txt')`);
  const rejectedFile = upload('reject.txt');
  await assert.rejects(service.saveProgress(admin, Number(task.id), { ...payload, links: [{ url: 'https://example.com/first' }] }, [rejectedFile]), /reject_integration_file/);
  assert.deepEqual({ updates: await service.dailyUpdates.count(), assets: await service.assets.count(), logs: await service.logs.count() }, before);
  assert.equal(fs.existsSync(rejectedFile.path), false);
  await db.query(`ALTER TABLE task_assets DROP CONSTRAINT reject_integration_file`);
  await db.query(`ALTER TABLE task_logs ADD CONSTRAINT reject_integration_log CHECK(action <> 'daily_update') NOT VALID`);
  const logRejectedFile = upload('audit.txt');
  await assert.rejects(service.saveProgress(admin, Number(task.id), payload, [logRejectedFile]), /reject_integration_log/);
  assert.equal(await service.dailyUpdates.count(), before.updates);
  assert.equal(fs.existsSync(logRejectedFile.path), false);
  await db.query(`ALTER TABLE task_logs DROP CONSTRAINT reject_integration_log`);
  await service.deleteTaskAsset(admin, Number(task.id), Number(assets[0].id));
  await assert.rejects(service.deleteTaskAsset(admin, Number(task.id), Number(assets[1].id)), /最后一份资料/);
  await service.updateDailyUpdate(admin, Number(task.id), Number(materialRow.id), { ...payload, noMaterialReason: '资料已线下归档' });
  await service.deleteTaskAsset(admin, Number(task.id), Number(assets[1].id));
  assert.equal(await service.assets.count(), 0);
  const concurrentRow = await service.saveProgress(admin, Number(task.id), {
    ...payload, links: [{ url: 'https://example.com/one' }, { url: 'https://example.com/two' }],
  }, []);
  const concurrentAssets = await service.assets.find({ where: { dailyUpdateId: concurrentRow.id } });
  const lock = db.createQueryRunner();
  await lock.connect(); await lock.startTransaction();
  let deleting = [];
  let deleteResults;
  try {
    await lock.query(`SELECT id FROM tasks WHERE id=$1 FOR UPDATE`, [task.id]);
    deleting = concurrentAssets.map(asset => service.deleteTaskAsset(admin, Number(task.id), Number(asset.id))
      .then(() => ({ ok: true }), error => ({ ok: false, error })));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await service.assets.count({ where: { dailyUpdateId: concurrentRow.id } }), 2,
      'both deletions must wait for the common task lock before modifying assets');
  } finally {
    await lock.rollbackTransaction(); await lock.release();
    deleteResults = await Promise.all(deleting);
  }
  assert.equal(deleteResults.filter(result => result.ok).length, 1);
  assert.match(deleteResults.find(result => !result.ok).error.message, /最后一份资料/);
  assert.equal(await service.assets.count({ where: { dailyUpdateId: concurrentRow.id } }), 1);

  // Clearing a reason and deleting the last material cannot both commit, even through the legacy edit route.
  await service.updateDailyUpdate(admin, Number(task.id), Number(concurrentRow.id), { ...payload, noMaterialReason: '原说明' });
  const [last] = await service.assets.find({ where: { dailyUpdateId: concurrentRow.id } });
  const race = await Promise.allSettled([
    service.updateDailyUpdate(admin, Number(task.id), Number(concurrentRow.id), { ...payload, noMaterialReason: '' }),
    service.deleteTaskAsset(admin, Number(task.id), Number(last.id)),
  ]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const final = await service.dailyUpdates.findOneByOrFail({ id: concurrentRow.id });
  assert.ok(final.noMaterialReason?.trim() || await service.assets.count({ where: { dailyUpdateId: concurrentRow.id } }));
  const sharedSource = await service.saveProgress(admin, Number(task.id), {
    ...payload, noMaterialReason: '历史说明', links: [{ url: 'https://example.com/shared' }],
  }, []);
  const [shared] = await service.assets.find({ where: { dailyUpdateId: sharedSource.id } });
  assert.deepEqual(shared.linkedDailyUpdateIds, []);
  const assetCount = await service.assets.count();
  const linkedRows = await Promise.all([1, 2].map(n => service.saveProgress(admin, Number(task.id), {
    ...payload, content: '复用文件 ' + n, existingAssetIds: [Number(shared.id)],
  }, [])));
  assert.equal(await service.assets.count(), assetCount);
  let persisted = await service.assets.findOneByOrFail({ id: shared.id });
  assert.deepEqual(persisted.linkedDailyUpdateIds.map(Number).sort((a,b)=>a-b), linkedRows.map(r=>Number(r.id)).sort((a,b)=>a-b));
  await assert.rejects(service.unlinkTaskAsset(admin, Number(task.id), Number(linkedRows[0].id), Number(shared.id)), /最后|原因/);
  await assert.rejects(service.deleteTaskAsset(admin, Number(task.id), Number(shared.id)), /多条/);
  await service.unlinkTaskAsset(admin, Number(task.id), Number(sharedSource.id), Number(shared.id));
  persisted = await service.assets.findOneByOrFail({ id: shared.id });
  assert.equal(persisted.dailyUpdateId, null);
  assert.equal(persisted.linkedDailyUpdateIds.length, 2);
  await service.deleteDailyUpdate(admin, Number(task.id), Number(linkedRows[0].id));
  persisted = await service.assets.findOneByOrFail({ id: shared.id });
  assert.deepEqual(persisted.linkedDailyUpdateIds.map(Number), [Number(linkedRows[1].id)]);
  await db.query(`ALTER TABLE task_logs ADD CONSTRAINT reject_unlink_log CHECK(action <> 'task_asset_unlink') NOT VALID`);
  await service.updateDailyUpdate(admin, Number(task.id), Number(linkedRows[1].id), { ...payload, noMaterialReason: '线下保留' });
  await assert.rejects(service.unlinkTaskAsset(admin, Number(task.id), Number(linkedRows[1].id), Number(shared.id)), /reject_unlink_log/);
  assert.deepEqual((await service.assets.findOneByOrFail({ id: shared.id })).linkedDailyUpdateIds.map(Number), [Number(linkedRows[1].id)]);
  await db.query(`ALTER TABLE task_logs DROP CONSTRAINT reject_unlink_log`);
  console.log('Shared assets PostgreSQL integration passed: migration default, concurrent reuse, unique counts, guarded unlink, progress deletion, audit rollback.');
  console.log('Progress save PostgreSQL integration passed: migration, atomic files/links/logs, rollback, cleanup, concurrent deletion and legacy edit/delete invariant.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (db?.isInitialized) await db.destroy();
  if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  if (control.isInitialized) await control.destroy();
  for (const filename of files) if (fs.existsSync(filename)) fs.unlinkSync(filename);
});
