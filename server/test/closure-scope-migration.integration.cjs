// Local-only regression: upgrade a pre-scope_identity table in an isolated schema.
const assert=require('node:assert/strict');const fs=require('node:fs');
const env=require('dotenv').parse(fs.readFileSync('.env'));
if(!['localhost','127.0.0.1','::1'].includes(env.DB_HOST||'localhost'))throw Error('Local database only');
const {DataSource}=require('typeorm');
const {AddClosureAnalysisScopeIdentity1801100000000}=require('../src/migrations/1801100000000-AddClosureAnalysisScopeIdentity');
const db=new DataSource({type:'postgres',host:env.DB_HOST||'localhost',port:Number(env.DB_PORT||5432),username:env.DB_USERNAME,password:env.DB_PASSWORD,database:env.DB_DATABASE});
(async()=>{await db.initialize();const q=db.createQueryRunner();await q.connect();await q.startTransaction();
 try{
  const schema=`closure_scope_it_${process.pid}`;await q.query(`CREATE SCHEMA "${schema}"`);await q.query(`SET LOCAL search_path TO "${schema}"`);
  await q.query('CREATE TABLE closure_analysis_jobs(id serial PRIMARY KEY,status varchar(20),result jsonb,error text,finished_at timestamptz)');
  await q.query(`INSERT INTO closure_analysis_jobs(status,result) VALUES ('success','{"kept":true}'),('queued',NULL),('processing',NULL)`);
  const migration=new AddClosureAnalysisScopeIdentity1801100000000();await migration.up(q);
  const rows=await q.query('SELECT * FROM closure_analysis_jobs ORDER BY id');
  assert.deepEqual(rows.map(r=>r.scope_identity),['','','']);assert.deepEqual(rows[0].result,{kept:true});assert.equal(rows[0].status,'success');
  for(const r of rows.slice(1)){assert.equal(r.status,'failed');assert.ok(r.finished_at);assert.match(r.error,/重新解析/);}
  await q.query("INSERT INTO closure_analysis_jobs(status,scope_identity) VALUES('queued',$1)",['a'.repeat(64)]);
  await migration.up(q);const [current]=await q.query('SELECT * FROM closure_analysis_jobs WHERE id=4');assert.equal(current.status,'queued');assert.equal(current.scope_identity,'a'.repeat(64));
  const [column]=await q.query("SELECT is_nullable,character_maximum_length FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='closure_analysis_jobs' AND column_name='scope_identity'");assert.equal(column.is_nullable,'NO');assert.equal(column.character_maximum_length,64);
  console.log('PASS: legacy upgrade, historical result preservation, stale active jobs, current schema compatibility and repeat upgrade');
 }finally{await q.rollbackTransaction();await q.release();}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(db.isInitialized)await db.destroy()});
