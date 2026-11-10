// Local PostgreSQL only. Creates and removes an isolated schema; no application startup or notifications.
// node -r dotenv/config test/progress-cleanup-sql.integration.cjs
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');

async function main() {
  const host = process.env.DB_HOST;
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(host), 'Only a local test database is allowed');
  const client = new Client({ host, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD, database: process.env.DB_DATABASE });
  const schema = `progress_cleanup_it_${crypto.randomBytes(8).toString('hex')}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE users (id bigint PRIMARY KEY, name text, is_active boolean);
      CREATE TABLE user_roles (user_id bigint, role text);
      CREATE TABLE projects (id bigint PRIMARY KEY, name text, status text);
      CREATE TABLE tasks (id bigint PRIMARY KEY, project_id bigint, title text, status text, completed_at timestamptz);
      CREATE TABLE task_daily_updates (id bigint PRIMARY KEY, project_id bigint, task_id bigint, user_id bigint, work_date date, content text, status text, created_at timestamptz DEFAULT now());
      CREATE TABLE task_assets (id bigint PRIMARY KEY, daily_update_id bigint REFERENCES task_daily_updates(id));
      CREATE TABLE task_logs (id bigserial PRIMARY KEY, task_id bigint, project_id bigint, operator_id bigint, action text, payload jsonb, created_at timestamptz);
      INSERT INTO users VALUES (1, '示例执行人', true);
      INSERT INTO user_roles VALUES (1, 'admin');
      INSERT INTO projects VALUES (18, '示例流程改进项目', 'active');
      INSERT INTO tasks VALUES (451, 18, '设备制造', 'done', '2026-09-13T10:00:00Z');
      INSERT INTO task_daily_updates (id, project_id, task_id, user_id, work_date, content, status) VALUES
        (901, 18, 451, 1, '2026-09-21', '测试', 'normal'),
        (902, 18, 451, 1, '2026-09-21', '真实业务进展', 'normal');
      INSERT INTO task_assets VALUES (801, 901), (802, 902);
    `);
    const original = fs.readFileSync(path.join(__dirname, '../scripts/20260921-clean-test-progress.sql'), 'utf8');
    const trial = original.replace('v_update_id bigint := 0;', 'v_update_id bigint := 901;').replace('v_operator_id bigint := 0;', 'v_operator_id bigint := 1;');
    await client.query(trial);
    assert.equal((await client.query('SELECT count(*) FROM task_daily_updates')).rows[0].count, '2');
    assert.equal((await client.query('SELECT count(*) FROM task_logs')).rows[0].count, '0');
    await assert.rejects(client.query(trial.replace('v_update_id bigint := 901;', 'v_update_id bigint := 902;')), /未精确匹配/);
    await client.query('ROLLBACK');
    await assert.rejects(client.query(original), /请先填写/);
    await client.query('ROLLBACK');
    await client.query(trial.replace(/ROLLBACK;\s*$/, 'COMMIT;'));
    const updates = (await client.query('SELECT id, content FROM task_daily_updates ORDER BY id')).rows;
    assert.deepEqual(updates, [{ id: '902', content: '真实业务进展' }]);
    assert.deepEqual((await client.query('SELECT * FROM task_assets ORDER BY id')).rows, [{ id: '801', daily_update_id: null }, { id: '802', daily_update_id: '902' }]);
    const task = (await client.query('SELECT status, completed_at FROM tasks')).rows[0];
    assert.equal(task.status, 'done');
    assert.equal(task.completed_at.toISOString(), '2026-09-13T10:00:00.000Z');
    const log = (await client.query('SELECT * FROM task_logs')).rows[0];
    assert.equal(log.action, 'daily_update_delete');
    assert.equal(log.payload.deletedUpdate.content, '测试');
    assert.deepEqual(log.payload.assetLinks, [{ id: 801, dailyUpdateId: 901 }]);
    console.log('PASS: SQL rollback, exact target guards, committed cleanup, unrelated data, attachment preservation and audit snapshot');
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
