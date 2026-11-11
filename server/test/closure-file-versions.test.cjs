const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {captureClosureAssets}=require('../src/modules/closures/closure-assets');
const {ClosuresService}=require('../src/modules/closures/closures.service');

test('closure captures only the current projection with its immutable version id',async()=>{
 const row={id:'7',project_id:'2',current_version_id:'13',file_path:'uploads/task-assets/v2',original_name:'v2.txt'};
 const assets=await captureClosureAssets({query:async(sql,args)=>{
  assert.match(sql,/FROM task_assets/);assert.deepEqual(args,[2]);return [row];
 }},2);
 assert.deepEqual(assets,[{...row,version_id:'13'}]);
 assert.equal(row.version_id,undefined);
});

test('historical report download uses its frozen file even when the live file changed',async()=>{
 const dir=path.resolve('uploads/task-assets');await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,`closure-version-test-${process.pid}.txt`);
 await fs.writeFile(file,'frozen v1');
 try {
  const service=Object.create(ClosuresService.prototype);
  service.one=async()=>({report:{assets:[{id:7,version_id:11,original_name:'old.txt',file_path:file}]},snapshot:{assets:[{id:7,version_id:12,original_name:'new.txt',file_path:'/nonexistent'}]}});
  service.db={query:async()=>{throw Error('must not resolve live assets or mutate read-only access');}};
  const result=await service.downloadAsset({userId:1,readOnly:true},1,7);
  assert.equal(result.filename,'old.txt');
  const parts=[];for await(const part of result.stream)parts.push(part);
  assert.equal(Buffer.concat(parts).toString(),'frozen v1');
 }finally{await fs.unlink(file);}
});
