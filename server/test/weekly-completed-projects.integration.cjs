const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
const { weekNeedsExecutionReportSql } = require('../src/modules/project-weekly-reports/weekly-obligations');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost','127.0.0.1','::1'].includes(env.DB_HOST || 'localhost'));
const client = new Client({host:env.DB_HOST || 'localhost',port:Number(env.DB_PORT || 5432),user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE});
async function main() {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE tasks(id int,project_id int,parent_id int,status text,completed_at timestamptz) ON COMMIT DROP`);
    const required = async week => (await client.query(`SELECT ${weekNeedsExecutionReportSql('1','$1')} AS required`,[week])).rows[0].required;
    assert.equal(await required('2026-11-09'),true,'no tasks is not considered fully completed');
    await client.query(`INSERT INTO tasks VALUES (1,1,NULL,'doing',NULL),(2,1,1,'done','2026-11-08T23:59:59+08:00'),(3,1,1,'cancelled',NULL)`);
    assert.equal(await required('2026-11-02'),true,'completion week still requires a report');
    assert.equal(await required('2026-11-09'),false,'later week does not require a report, ignoring roll-up parent and cancelled task');
    await client.query(`UPDATE tasks SET completed_at='2026-11-09T00:00:00+08:00' WHERE id=2`);
    assert.equal(await required('2026-11-09'),true,'Beijing Monday boundary is inclusive');
    assert.equal(await required('2026-11-16'),false);
    await client.query(`UPDATE tasks SET status='doing',completed_at=NULL WHERE id=2`);
    assert.equal(await required('2026-11-16'),true,'reopened task resumes reporting');
    await client.query(`UPDATE tasks SET status='done' WHERE id=2`);
    assert.equal(await required('2026-11-16'),true,'unknown completion date must not erase reporting obligations');
    console.log('completed-project weekly obligation regression passed');
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
main().catch(error=>{ console.error(error.message);process.exitCode=1; });
