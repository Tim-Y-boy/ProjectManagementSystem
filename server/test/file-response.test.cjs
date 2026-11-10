require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Controller,Get,Module,StreamableFile}=require('@nestjs/common');
const {NestFactory}=require('@nestjs/core');
const {ResponseInterceptor}=require('../src/common/response.interceptor');

test('charter and asset downloads preserve PDF bytes; normal APIs keep envelope',async()=>{
  const pdf=Buffer.from('%PDF-1.4\nfile response regression\n%%EOF');
  class Files {
    charter(){return new StreamableFile(pdf,{type:'application/octet-stream',disposition:"attachment; filename*=UTF-8''test.pdf"});}
    asset(){return this.charter();}
    info(){return {name:'test'};}
  }
  Controller('closures')(Files);
  for(const [method,route] of [['charter','1/charters/1/download'],['asset','1/assets/1/download'],['info','1']])Get(route)(Files.prototype,method,Object.getOwnPropertyDescriptor(Files.prototype,method));
  class TestModule {} Module({controllers:[Files]})(TestModule);
  const app=await NestFactory.create(TestModule,{logger:false});
  app.useGlobalInterceptors(new ResponseInterceptor());
  try {
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();
    for(const kind of ['charters','assets']){
      const response=await fetch(`${base}/closures/1/${kind}/1/download`);
      assert.equal(response.status,200);
      assert.match(response.headers.get('content-disposition'),/test.pdf/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf,`${kind} must return original file bytes`);
    }
    assert.deepEqual(await (await fetch(`${base}/closures/1`)).json(),{code:0,data:{name:'test'},message:'ok'});
  } finally {await app.close();}
});
