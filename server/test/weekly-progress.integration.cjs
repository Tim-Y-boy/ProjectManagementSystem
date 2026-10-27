// Local PostgreSQL only; isolated schema, fake notifications, no business rows touched.
// Run: node -r ts-node/register/transpile-only test/weekly-progress.integration.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { WeeklyProgressService } = require('../src/modules/tasks/weekly-progress.service');
const { config } = require('../src/config/config');
const env = require('dotenv').parse(fs.readFileSync('.env'));
if (!['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost')) throw new Error('Local database only');
const schema = `weekly_progress_it_${process.pid}`;
if (!/^weekly_progress_it_\d+$/.test(schema)) throw new Error('Invalid isolated schema');
const options = { type: 'postgres', host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432), username: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE, logging: false };
const control = new DataSource(options);
let db, created = false;
async function main() {
  await control.initialize();
  await control.query(`CREATE SCHEMA "${schema}"`); created = true;
  db = new DataSource({ ...options, schema, extra: { options: `-c search_path=${schema}` }, migrations: [path.resolve('src/migrations/*.ts')] });
  await db.initialize(); await db.runMigrations();
  await db.query(`UPDATE weekly_progress_settings SET enabled_at='2026-09-09T12:00:00+08:00'`);
  await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(1,'执行甲','weekly_a'),(2,'执行乙','weekly_b'),(3,'负责人','weekly_c')`);
  await db.query(`INSERT INTO projects(id,name,created_by,owner_id,plan_locked) VALUES(1,'周进展隔离测试',3,3,true)`);
  await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,status,created_at)
    VALUES(1,1,'进行中的具体任务',3,1,'doing','2026-09-01'),(2,1,'取消的任务',3,1,'cancelled','2026-09-01')`);
  await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,status,created_at)
    VALUES(100,1,'采购主任务',3,'doing','2026-09-01'),(101,1,'供应商子阶段',3,'doing','2026-09-01')`);
  await db.query(`UPDATE tasks SET parent_id=100 WHERE id=101`);
  await db.query(`UPDATE tasks SET parent_id=101 WHERE id=1`);
  await db.query(`INSERT INTO task_assignees(task_id,role,user_id) VALUES(1,'assignee',1),(1,'assignee',2)`);
  const sent = []; let failPersonal = true;
  const service = new WeeklyProgressService(db, {
    sendCard: async (...args) => { sent.push(['personal', ...args]); return { success: !failPersonal, response: { message: 'fake' } }; },
    sendGroupCard: async (...args) => { sent.push(['group', ...args]); return { success: true }; },
  });
  const now = new Date('2026-09-14T09:00:00+08:00');
  await Promise.all([service.collect(now), service.collect(now)]);
  assert.equal((await db.query(`SELECT * FROM weekly_progress_checks`)).length, 1, 'parallel collection deduplicates task/week and excludes cancelled tasks');
  assert.equal((await service.missingRows(db.manager, 1)).length, 1);
  assert.equal((await service.missingRows(db.manager, 2)).length, 1);
  assert.equal((await service.missingRows(db.manager, 3)).length, 0, 'non-executors do not receive personal todo');
  config.feishu.briefGroupChatId = 'oc_isolated_fake_weekly_group';
  await Promise.all([service.dispatch(), service.dispatch()]);
  assert.equal(sent.length, 3, 'one dispatch per recipient/group under concurrent scanning');
  const groupCard = sent.find(message => message[0] === 'group')[3];
  assert.equal(groupCard.schema, '2.0');
  assert.ok(JSON.stringify(groupCard).includes('<at id=weekly_c></at>'), 'project owner receives a real mention');
  assert.equal(groupCard.body.elements.filter(e => e.tag === 'column_set').length, 1);
  failPersonal = false;
  await service.dispatch();
  assert.equal(sent.length, 5, 'only failed personal deliveries retry');
  await service.dispatch();
  assert.equal(sent.length, 5, 'successful deliveries deduplicate across scans');
  assert.ok(JSON.stringify(sent).includes('weekStart=2026-09-07'));
  assert.ok(JSON.stringify(sent).includes('负责人'));
  await db.query(`UPDATE projects SET plan_locked=false WHERE id=1`);
  assert.equal((await service.missingRows(db.manager, 1)).length, 0, 'unlocked plans cannot prompt unavailable entry');
  await db.query(`UPDATE projects SET plan_locked=true WHERE id=1`);
  await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,status,created_at)
    VALUES(3,1,'稍后通过验收的任务',3,1,'pending_accept','2026-09-01')`);
  await db.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,from_status,to_status,created_at)
    VALUES(3,1,1,'transition','doing','pending_accept','2026-09-11T17:00:00+08:00')`);
  await service.collect(now); await service.dispatch();
  assert.equal(sent.length, 5, 'pending acceptance does not generate messages');
  await db.query(`UPDATE tasks SET status='done' WHERE id=3`);
  await service.collect(now); await service.dispatch();
  assert.equal(sent.length, 7, 'newly eligible task sends incremental personal and group messages in same week');
  await service.dispatch(); assert.equal(sent.length, 7, 'incremental messages also deduplicate');
  await db.query(`UPDATE tasks SET status='cancelled' WHERE id=3`); await service.collect(now);
  await db.query(`UPDATE tasks SET status='pending_accept' WHERE id=1`);
  assert.equal((await service.missingRows(db.manager, 1)).length, 0, 'pending acceptance retains audit but does not prompt an unavailable form');
  await db.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,from_status,to_status,created_at)
    VALUES(1,1,1,'transition','doing','done','2026-09-11T17:00:00+08:00')`);
  await db.query(`UPDATE tasks SET status='done' WHERE id=1`);
  await service.collect(now);
  assert.equal((await service.missingRows(db.manager, 1)).length, 1, 'completed task retains final doing week');
  await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content,created_at)
    VALUES(1,1,2,'2026-09-10','由任一执行人补填','2026-09-15T10:00:00+08:00')`);
  await service.collect(new Date('2026-09-15T11:00:00+08:00'));
  for (const id of [1, 2]) assert.equal((await service.missingRows(db.manager, id)).length, 0);
  const [resolved] = await db.query(`SELECT * FROM weekly_progress_checks WHERE task_id=1`);
  assert.equal(resolved.status, 'resolved'); assert.equal(resolved.is_late, true); assert.ok(resolved.submitted_at);
  await db.query(`DELETE FROM task_daily_updates WHERE task_id=1`);
  await service.collect(now);
  assert.equal((await service.missingRows(db.manager, 1)).length, 1, 'deleting last progress restores pending work');
  for (const state of ['pending', 'closed']) {
    await db.query(`UPDATE projects SET closure_state=$1 WHERE id=1`, [state]); await service.collect(now);
    assert.equal((await service.missingRows(db.manager, 1)).length, 0);
    assert.equal((await db.query(`SELECT status FROM weekly_progress_checks WHERE task_id=1`))[0].status, 'suppressed');
  }
  await db.query(`UPDATE projects SET closure_state='none',status='archived' WHERE id=1`); await service.collect(now);
  assert.equal((await service.missingRows(db.manager, 1)).length, 0);
  assert.equal((await db.query(`SELECT * FROM weekly_progress_checks`)).length, 2, 'archive retains audit');
  // Acceptance derives missing weeks directly, even when the scheduler never stored a check.
  await db.query(`UPDATE projects SET status='active',closure_state='none' WHERE id=1`);
  await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,status,created_at)
    VALUES(4,1,'验收缺周隔离测试',3,1,'doing','2026-09-07T09:00:00+08:00')`);
  await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content)
    VALUES(1,4,1,'2026-09-10','第一周'),(1,4,1,'2026-09-22','第三周')`);
  const acceptanceTime = new Date('2026-09-23T10:00:00+08:00');
  const beforeValidationSends = sent.length;
  assert.deepEqual(await service.missingWeeksForTask(4, acceptanceTime), [{ weekStart: '2026-09-14', weekEnd: '2026-09-20' }]);
  assert.equal((await db.query(`SELECT * FROM weekly_progress_checks WHERE task_id=4`)).length, 0);
  await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content)
    VALUES(1,4,2,'2026-09-18','另一执行人补录第二周')`);
  assert.deepEqual(await service.missingWeeksForTask(4, acceptanceTime), []);
  await db.query(`DELETE FROM task_daily_updates WHERE task_id=4 AND work_date='2026-09-18'`);
  await db.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,from_status,to_status,created_at)
    VALUES(4,1,1,'transition','doing','pending_accept','2026-09-22T17:00:00+08:00')`);
  await db.query(`UPDATE tasks SET status='pending_accept' WHERE id=4`);
  assert.deepEqual(await service.missingWeeksForTask(4, new Date('2026-10-05T10:00:00+08:00')), [{ weekStart: '2026-09-14', weekEnd: '2026-09-20' }]);
  await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,status,start_at,due_at,created_at)
    VALUES(5,1,'历史计划新建任务',3,1,'doing','2026-09-01','2026-09-15','2026-10-08T13:00:00+08:00')`);
  await db.query(`INSERT INTO task_logs(task_id,project_id,operator_id,action,from_status,to_status,created_at)
    VALUES(5,1,1,'transition','todo','doing','2026-10-09T09:00:00+08:00')`);
  await db.query(`INSERT INTO task_daily_updates(project_id,task_id,user_id,work_date,content)
    VALUES(1,5,1,'2026-09-04','仅第一周有进展')`);
  const historicalMissing = await service.missingWeeksForTask(5, new Date('2026-10-09T10:00:00+08:00'));
  assert.deepEqual(historicalMissing, [{ weekStart: '2026-10-05', weekEnd: '2026-10-11' }]);
  await db.query(`UPDATE weekly_progress_settings SET enabled_at='2026-10-21T12:00:00+08:00'`);
  await service.collect(new Date('2026-10-21T13:00:00+08:00'));
  assert.equal((await db.query(`SELECT * FROM weekly_progress_checks WHERE status='missing'`)).length, 0,
    'obsolete reminders are suppressed after recalculating with the new activation window');
  assert.equal(sent.length, beforeValidationSends, 'validation is read-only and never sends messages');
  console.log('weekly-progress PostgreSQL integration checks passed (fake notifications only)');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (db?.isInitialized) await db.destroy();
  if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
  if (control.isInitialized) await control.destroy();
});
