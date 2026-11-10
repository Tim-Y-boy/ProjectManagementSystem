// Local isolated schema, no real notifications.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DataSource } = require('typeorm');
const { WeeklyProgressService } = require('../src/modules/tasks/weekly-progress.service');
const { ClosuresService } = require('../src/modules/closures/closures.service');
const { CharterAnalysisService } = require('../src/modules/closures/charter-analysis.service');
const { DELAY_DIGEST_SQL } = require('../src/modules/closures/project-delay-digest');
const env = require('dotenv').parse(fs.readFileSync('.env'));
assert.ok(['localhost','127.0.0.1','::1'].includes(env.DB_HOST || 'localhost'));
const options = {type:'postgres',host:env.DB_HOST || 'localhost',port:Number(env.DB_PORT || 5432),username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE};
const schema = `termination_lifecycle_${process.pid}`;
const control = new DataSource(options); let db;
const user = { userId:1,name:'测试',roles:['admin'],managedDeptIds:[] };
async function main() {
  await control.initialize(); await control.query(`CREATE SCHEMA "${schema}"`);
  db = new DataSource({...options,schema,extra:{options:`-c search_path=${schema}`},migrations:[path.resolve('src/migrations/*.ts')]});
  await db.initialize(); await db.runMigrations();
  await db.query(`INSERT INTO users(id,name,feishu_user_id) VALUES(1,'测试','test_lifecycle')`);
  await db.query(`INSERT INTO projects(id,name,created_by,owner_id,plan_locked,end_at) VALUES(1,'测试',1,1,true,'2026-09-01')`);
  await db.query(`INSERT INTO tasks(id,project_id,title,creator_id,assignee_id,status,start_at,due_at,created_at) VALUES(1,1,'测试',1,1,'doing','2026-09-01','2026-09-30','2026-09-01')`);
  await db.query(`UPDATE weekly_progress_settings SET enabled_at='2026-09-07T00:00:00+08:00'`);
  await db.query(`INSERT INTO task_daily_updates(id,project_id,task_id,user_id,work_date,content,status) VALUES(1,1,1,1,'2026-09-30','历史进展','supplemented'),(2,1,1,1,'2026-09-30','历史合理补填','exempted')`);
  await db.query(`INSERT INTO closure_notices(id,event_key,project_id,recipient_id,kind,payload) VALUES(1,'test1',1,1,'supplement_notice','{}'),(2,'test2',1,1,'supplement_notice','{}')`);
  await db.query(`UPDATE closure_notices SET acknowledged_at=NOW() WHERE id=2`);
  let sends = 0;
  const notify = {isReadOnlyRecipient:async()=>false,sendCard:async()=>{sends++;return {success:true};},sendGroupCard:async()=>{sends++;return {success:true};}};
  const weekly = new WeeklyProgressService(db,notify);
  const closures = new ClosuresService(db,notify);
  const analysis = new CharterAnalysisService(db,{});
  const now = new Date('2026-09-28T09:00:00+08:00');
  await weekly.collect(now);
  assert.ok((await weekly.missingRows(db.manager,1)).length > 0);
  const staleRows = await weekly.missingRows(db.manager,1);
  for (const state of ['pending','terminated']) {
    await db.query(`UPDATE projects SET termination_state=$1,status=$2 WHERE id=1`,[state,state==='pending'?'active':'terminated']);
    assert.deepEqual(await weekly.missingWeeksForTask(1,now),[]);
    assert.deepEqual(await weekly.missingRows(db.manager,1),[]);
    await weekly.sendBatch({channel:'personal',target:'1',week:staleRows[0].weekStart,rows:[...staleRows]});
    assert.equal(sends,0,'a batch collected before termination must be rechecked before delivery');
    await weekly.collect(now);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM weekly_progress_checks WHERE status='missing'`))[0].n,0);
    await weekly.dispatch(); await closures.deliverNotices(); assert.equal(sends,0);
    assert.deepEqual(await closures.readyProjects(user),[]);
    assert.deepEqual(await db.query(DELAY_DIGEST_SQL,['2026-11-04']),[]);
    assert.equal((await closures.inbox(user)).length,1,'acknowledged history remains readable');
    await assert.rejects(closures.acknowledge(user,1),{status:400});
    await assert.rejects(closures.markSupplement(user,1,1,'test'),{status:400});
    await assert.rejects(closures.revokeSupplement(user,1,2,'supplemented'),{status:400});
    await assert.rejects(closures.saveDraft(user,1,{}),{status:400});
    await assert.rejects(analysis.start(user,1,{}), /终止/);
    await closures.observeProject(1);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM project_delay_records`))[0].n,0);
    assert.equal((await closures.facts(1)).tasks.length,1,'project facts remain readable');
  }
  await db.query(`UPDATE projects SET termination_state='none',status='active' WHERE id=1`);
  const lock = db.createQueryRunner(); await lock.connect();
  await lock.query('SELECT pg_advisory_lock(21017,hashtext($1))',['1']);
  try { await assert.rejects(analysis.start(user,1,{}),{status:409}); }
  finally { await lock.query('SELECT pg_advisory_unlock(21017,hashtext($1))',['1']); await lock.release(); }
  await weekly.collect(now); assert.ok((await weekly.missingRows(db.manager,1)).length > 0);
  assert.equal((await closures.inbox(user)).length,2,'unfreezing restores unacknowledged notices');
  assert.equal((await db.query(`SELECT status FROM task_daily_updates WHERE id=2`))[0].status,'exempted');
  console.log('Termination lifecycle integration passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(db?.isInitialized) await db.destroy();
  if(control.isInitialized){await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await control.destroy();}
});
