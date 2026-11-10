const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
function run(timezone,code) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tracker-log-test-'));
 try {
  const stdout=cp.execFileSync(process.execPath,['-r','ts-node/register/transpile-only','-e',`
   const NativeDate=Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-12-31T16:05:06.007Z']))}static now(){return new NativeDate('2026-12-31T16:05:06.007Z').getTime()}};
   const log=require('./src/common/runtime-logger');${code}
  `],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TZ:timezone,LOG_DIR:dir,LOG_CONSOLE:'true',LOG_ACCESS:'true',LOG_ACCESS_CONSOLE:'true'},encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const entries=fs.readdirSync(dir).filter(n=>n.endsWith('.log')).flatMap(n=>fs.readFileSync(path.join(dir,n),'utf8').trim().split('\n').map(s=>({file:n,...JSON.parse(s)})));
  return {stdout,entries};
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('all application log categories use Beijing time independently of host timezone',()=>{
 for(const timezone of ['UTC','America/New_York','Asia/Shanghai']){
  const {entries}=run(timezone,"log.writeAppLog('info','app');log.writeErrorLog('error');log.writeAccessLog({path:'/api/test'});log.writeSlowLog({durationMs:1234});");
  assert.equal(entries.length,4);
  for(const entry of entries)assert.equal(entry.time,'2027-01-01T00:05:06.007+08:00',timezone+' '+entry.file);
 }
});
test('console records contain a timestamp and preserve multiline error details in a single JSON line',()=>{
 const {stdout,entries}=run('UTC',"log.writeAppLog('info','first\\nsecond',{trace:'stack\\nnext'});");
 assert.equal(stdout.trim().split('\n').length,1);
 const entry=JSON.parse(stdout.trim());assert.equal(entry.time,'2027-01-01T00:05:06.007+08:00');assert.equal(entry.message,'first\nsecond');assert.equal(entry.trace,'stack\nnext');assert.equal(entries[0].trace,entry.trace);
});
test('SDK logger routes errors and context into timestamped error files',()=>{
 const {entries}=run('UTC',"log.sdkLogger.error('connection failed',new Error('socket closed'));");
 assert.equal(entries[0].file,'error.log');assert.equal(entries[0].time,'2027-01-01T00:05:06.007+08:00');assert.equal(entries[0].context,'FeishuSDK');assert.equal(entries[0].message[1].message,'socket closed');
});

test('rotation uses the Beijing calendar day rather than the host date',()=>{
 const {entries}=run('UTC',`
  const fs=require('fs'),path=require('path');
  const file=path.join(process.env.LOG_DIR,'app.log');
  log.writeAppLog('info','first');
  fs.utimesSync(file,new Date('2026-12-31T16:01:00Z'),new Date('2026-12-31T16:01:00Z'));
  log.writeAppLog('info','same Beijing day');
 `);
 assert.equal(entries.length,2);assert.ok(entries.every(e=>e.file==='app.log'));
});
test('rotation filename changes at Beijing midnight and keeps the original entry',()=>{
 const {entries}=run('UTC',`
  const fs=require('fs'),path=require('path');
  const file=path.join(process.env.LOG_DIR,'app.log');
  log.writeAppLog('info','previous');
  fs.utimesSync(file,new Date('2026-12-31T15:59:00Z'),new Date('2026-12-31T15:59:00Z'));
  log.writeAppLog('info','new day');
 `);
 assert.equal(entries.find(e=>e.message==='previous').file,'app-2026-12-31-000506.log');assert.equal(entries.find(e=>e.message==='new day').file,'app.log');
});
