const assert = require('node:assert/strict');
const fs = require('node:fs');
const { DataSource } = require('typeorm');
const { AddProjectTermination1802200000000 } = require('../src/migrations/1802200000000-AddProjectTermination');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST || 'localhost'));
const schema = `termination_migration_it_${process.pid}`;
const db = new DataSource({ type: 'postgres', host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 5432), username: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_DATABASE });
async function main() {
  await db.initialize();
  const q = db.createQueryRunner();
  await q.connect();
  await q.query(`CREATE SCHEMA "${schema}"`);
  try {
    await q.query(`SET search_path TO "${schema}"`);
    await q.query('CREATE TABLE projects(id bigint PRIMARY KEY)');
    const migration = new AddProjectTermination1802200000000();
    // Existing deployments can have a column without a migration ledger entry.
    await q.query("ALTER TABLE projects ADD COLUMN termination_state varchar(16) NOT NULL DEFAULT 'none'");
    await q.query("INSERT INTO projects VALUES(1,'pending')");
    await migration.up(q);
    await q.query(`INSERT INTO project_terminations(project_id,project_name,requester_id,requester_name,reason,stage,department_approver_id,final_approver_id) VALUES(1,'Existing',1,'Owner','Keep history','department',2,3)`);
    await migration.up(q);
    assert.equal((await q.query('SELECT termination_state FROM projects'))[0].termination_state, 'pending');
    assert.equal((await q.query('SELECT reason FROM project_terminations'))[0].reason, 'Keep history');
    await assert.rejects(q.query(`INSERT INTO project_terminations(project_id,project_name,requester_id,requester_name,reason,stage,department_approver_id,final_approver_id) VALUES(1,'Duplicate',1,'Owner','Duplicate','department',2,3)`), e => e.code === '23505');
    await migration.down(q);
    await migration.up(q);
    assert.equal((await q.query('SELECT termination_state FROM projects'))[0].termination_state, 'none');
    console.log('PASS: partial schema, repeated migration, preserved history, unique pending constraint, clean install');
  } finally {
    await q.query(`DROP SCHEMA "${schema}" CASCADE`);
    await q.release();
    await db.destroy();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
