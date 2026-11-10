const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
const { ProjectWeeklyReportsService } = require('../src/modules/project-weekly-reports/project-weekly-reports.service');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost','127.0.0.1','::1'].includes(env.DB_HOST || 'localhost'));
const client = new Client({host:env.DB_HOST || 'localhost',port:Number(env.DB_PORT || 5432),user:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE});
async function main() {
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const db = { query: async (sql,args) => (await client.query(sql,args)).rows };
    db.manager = db;
    const svc = new ProjectWeeklyReportsService(db, { recipient: async () => 0 });
    const user = { userId: 1, roles: ['admin'] };
    const now = new Date('2026-11-10T09:00:00+08:00');
    const start = performance.now();
    const rows = await svc.list(user, {weekStart:'2026-11-09'}, now);
    console.log(JSON.stringify({operation:'weekly list',ms:Math.round(performance.now()-start),rows:rows.length}));
    const all = await svc.rows(user,now);
    assert.deepEqual(rows, all.filter(r=>r.weekStart==='2026-11-09'));
    const normalize = values => values.map(r => ({ projectId: r.projectId, weekStart: r.weekStart, version: r.version })).sort((a,b) => `${a.projectId}:${a.weekStart}`.localeCompare(`${b.projectId}:${b.weekStart}`));
    assert.deepEqual(normalize(await svc.updates(user)), normalize(all.filter(r => r.status === 'submitted')));
    const member = { userId: 1, roles: [] };
    assert.deepEqual(normalize(await svc.updates(member)), normalize((await svc.rows(member,now)).filter(r => r.status === 'submitted')));
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
