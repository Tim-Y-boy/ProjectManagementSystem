const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { ProjectWeeklyReportsService } = require('../src/modules/project-weekly-reports/project-weekly-reports.service');
const { ProjectWeeklyNotificationsService } = require('../src/modules/tasks/project-weekly-notifications.service');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost'));
const options = { type: 'postgres', host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432),
  username: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE };
const schema = `project_weekly_notice_it_${process.pid}`;
const control = new DataSource(options);
let db;
async function main() {
  await control.initialize();
  await control.query(`CREATE SCHEMA "${schema}"`);
  try {
    db = new DataSource({ ...options, schema, extra: { options: `-c search_path=${schema}` }, migrations: [path.resolve('src/migrations/*.ts')] });
    await db.initialize(); await db.runMigrations();
    await db.query(`UPDATE project_weekly_report_settings SET enabled_at='2026-11-04T00:00:00+08:00'`);
    await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES (1,'Owner','notice_test_owner')`);
    await db.query(`INSERT INTO projects(id,name,owner_id,created_by,plan_locked,start_at,created_at)
      VALUES(1,'Notice project',1,1,true,'2026-10-01','2026-10-01')`);
    // A stray pre-activation record must not trigger retrospective summaries.
    await db.query(`INSERT INTO project_weekly_reports(project_id,week_start) VALUES(1,'2026-10-26')`);
    const reports = new ProjectWeeklyReportsService(db, { recipient: async () => null });
    const service = new ProjectWeeklyNotificationsService(db, reports);
    const seen = [];
    const deliver = async summary => { seen.push(summary?.summaries.map(s=>s.weekStart) || null); return { sent: true }; };
    const monday = new Date('2026-11-16T09:00:00+08:00');
    await service.withLeaderSummary(monday, async summary => {
      assert.equal(summary.weekStart, '2026-11-02'); return { sent: false };
    });
    assert.equal((await db.query('SELECT * FROM project_weekly_notification_deliveries')).length, 0, 'failure is retryable');
    await service.withLeaderSummary(monday, deliver);
    await service.withLeaderSummary(monday, deliver);
    assert.deepEqual(seen, [['2026-11-02', '2026-11-09'], null], 'Monday 09:00 includes the just-ended week');
    await service.withLeaderSummary(new Date('2026-12-01T09:00:00+08:00'), deliver);
    await service.withLeaderSummary(new Date('2026-12-02T09:00:00+08:00'), deliver);
    await service.withLeaderSummary(new Date('2026-12-03T09:00:00+08:00'), deliver);
    await service.withLeaderSummary(new Date('2026-12-04T09:00:00+08:00'), deliver);
    assert.deepEqual(seen.slice(2), [['2026-11-16', '2026-11-23'], null, null, null], 'merged backlog drains without repeating successes');
    const ledger = await db.query(`SELECT to_char(week_start,'YYYY-MM-DD') AS week FROM project_weekly_notification_deliveries ORDER BY week_start`);
    assert.deepEqual(ledger.map(row => row.week), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
    const blocker = db.createQueryRunner();
    await blocker.connect();
    try {
      await blocker.query('SELECT pg_advisory_lock(781260, 30)');
      const result = await service.withLeaderSummary(new Date('2026-12-08T09:00:00+08:00'), async () => { throw Error('must not deliver concurrently'); });
      assert.equal(result.skipped, 'already_running');
    } finally { await blocker.query('SELECT pg_advisory_unlock(781260, 30)'); await blocker.release(); }
    console.log('project weekly notifications isolated PostgreSQL integration passed; no real notifications sent');
  } finally {
    if (db?.isInitialized) await db.destroy();
    await control.query(`DROP SCHEMA "${schema}" CASCADE`);
    await control.destroy();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
