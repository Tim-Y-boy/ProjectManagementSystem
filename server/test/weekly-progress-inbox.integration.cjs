// Local-only, isolated schema. No real notifications or business data are changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { WeeklyProgressService } = require('../src/modules/tasks/weekly-progress.service');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost'));
const schema = `weekly_inbox_it_${process.pid}`;
const options = { type: 'postgres', host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432), username: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE };
async function main() {
  const control = new DataSource(options);
  await control.initialize();
  await control.query(`CREATE SCHEMA "${schema}"`);
  let db;
  try {
    db = new DataSource({ ...options, schema, extra: { options: `-c search_path=${schema}` }, migrations: [path.resolve('src/migrations/*.ts')] });
    await db.initialize(); await db.runMigrations();
    await db.query(`UPDATE weekly_progress_settings SET enabled_at='2026-09-07T00:00:00+08:00'`);
    await db.query(`INSERT INTO users(id,name,feishu_user_id) SELECT id,'用户'||id,'weekly_inbox_'||id FROM generate_series(1,7) id`);
    await db.query(`INSERT INTO projects(id,name,created_by,owner_id,plan_locked) VALUES(1,'负责项目',1,1,true),(2,'其他项目',7,7,true)`);
    await db.query(`INSERT INTO project_owners(project_id,user_id) VALUES(1,5)`);
    await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,acceptor_id,status,created_at)
      VALUES(1,1,'历史缺填任务',1,2,3,'doing','2026-09-07T00:00:00+08:00'),
      (2,2,'其他项目任务',7,7,7,'doing','2026-09-07T00:00:00+08:00')`);
    await db.query(`INSERT INTO task_assignees(task_id,role,user_id) VALUES(1,'acceptor',4),(1,'assignee',6)`);
    const service = new WeeklyProgressService(db, {});
    const collect = service.collect.bind(service);
    service.collect = () => collect(new Date('2026-09-28T09:00:00+08:00'));
    for (const id of [1,2,3,4,5,6]) {
      const { items } = await service.listForUser(id);
      assert.equal(items.length, 3, `user ${id} sees all three old weeks`);
      assert.ok(items.every(row => row.taskId === '1'));
      assert.equal(items[0].responsibility, [2,6].includes(id) ? 'execute' : 'manage');
      assert.ok(items.every(row => row.mobilePath.startsWith('/mobile/task/1?weekStart=')));
    }
    assert.ok((await service.listForUser(7)).items.every(row => row.taskId === '2'), 'unrelated project remains isolated');
    // A status transition must not hide the missing execution weeks.
    await db.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,from_status,to_status,created_at)
      VALUES(1,1,2,'transition','doing','pending_accept','2026-09-27T12:00:00+08:00')`);
    await db.query(`UPDATE tasks SET status='pending_accept' WHERE id=1`);
    assert.equal((await service.listForUser(3)).items.length, 3);
    await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content)
      VALUES(1,1,2,'2026-09-09','补填第一周')`);
    for (const id of [1,2,3,4,5,6]) {
      const { items } = await service.listForUser(id);
      assert.equal(items.length, 2, 'only the filled week disappears for every recipient');
      assert.ok(items.every(row => row.weekStart !== '2026-09-07'));
    }
    await db.query(`INSERT INTO task_assignees(task_id,role,user_id) VALUES(1,'assignee',1),(1,'acceptor',1)`);
    assert.equal((await service.listForUser(1)).items.length, 2, 'overlapping roles do not duplicate weeks');
    await db.query(`UPDATE tasks SET status='cancelled' WHERE id=1`);
    assert.equal((await service.listForUser(1)).items.length, 0);
    console.log('PASS: owners/co-owners, task managers/co-managers, executors, historical weeks, pending acceptance, fill resolution, role deduplication and isolation');
  } finally {
    if (db?.isInitialized) await db.destroy();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    await control.destroy();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
