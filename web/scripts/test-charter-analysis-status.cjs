const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const Module=require('node:module');
const filename=require('node:path').resolve('src/utils/charter-analysis-status.ts');
const mod=new Module(filename);mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,filename);
const {isCurrentAnalysisRunning}=mod.exports;
test('only current file set and configuration can occupy analysis button',()=>{
 const job={file_ids:[1,2],config_version:3,status:'processing',stale:false};
 assert.equal(isCurrentAnalysisRunning(job,[2,1],3),true);
 assert.equal(isCurrentAnalysisRunning(job,[4],3),false);
 assert.equal(isCurrentAnalysisRunning(job,[1,2],4),false);
 assert.equal(isCurrentAnalysisRunning({...job,stale:true},[1,2],3),false);
 assert.equal(isCurrentAnalysisRunning({...job,status:'success'},[1,2],3),false);
 assert.equal(isCurrentAnalysisRunning(null,[1],3),false);
});
