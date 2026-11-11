const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');

function api(get){
 const exports={};
 const source=fs.readFileSync('src/api/index.ts','utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>{if(name==='./request')return {http:{get}};if(name==='./project-weekly-reports')return {};throw Error(name);}});
 return exports.tasksApi;
}
test('missing project pool route falls back to task assets so completed task detail can open',async()=>{
 const calls=[], assets=[{id:9,title:'已有资料'}];
 const tasks=api(async(url,config)=>{calls.push([url,config]);if(url.endsWith('/project-assets'))throw {status:404,missingRoute:true};return assets;});
 assert.equal(await tasks.projectAssets(80),assets);
 assert.equal(calls[0][1].allowMissingRoute,true);
 assert.equal(calls[1][0],'/tasks/80/assets');
});
test('new backend returns the whole project pool without fallback',async()=>{
 let calls=0;const assets=[{id:10,taskId:81}];
 assert.equal(await api(async()=>{calls++;return assets;}).projectAssets(80),assets);
 assert.equal(calls,1);
});
test('permission errors, server errors and real not-found errors are not hidden',async()=>{
 for(const error of [{status:403},{status:500},{status:404,message:'任务不存在'}]){
  let calls=0;
  await assert.rejects(api(async()=>{calls++;throw error;}).projectAssets(80),e=>e===error);
  assert.equal(calls,1);
 }
});
