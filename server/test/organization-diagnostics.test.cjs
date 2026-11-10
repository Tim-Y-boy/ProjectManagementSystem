const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {FeishuSyncService}=require('../src/modules/feishu/feishu-sync.service');
const keys=['FEISHU_READONLY_ROOT_DEPTS','FEISHU_SYNC_ROOT_DEPT','FEISHU_READONLY_USER_IDS'];let previous;
beforeEach(()=>{previous=keys.map(k=>process.env[k]);process.env.FEISHU_READONLY_ROOT_DEPTS='od-ro';process.env.FEISHU_SYNC_ROOT_DEPT='od-business';delete process.env.FEISHU_READONLY_USER_IDS;});
afterEach(()=>keys.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]));
function fixture(ids,getDepartment=async()=>({parent_department_id:'0'})){
 const logs=[];let writes=0;
 const service=new FeishuSyncService({}, {findOne:async()=>null,save:async()=>writes++}, {create:v=>v,save:async v=>logs.push({...v})}, {isConfigured:()=>true,getUser:async()=>({department_ids:ids}),getDepartment});
 return {service,logs,get writes(){return writes}};
}
for(const [name,ids,lookup,code] of [
 ['missing departments',[],undefined,'ORG_DEPARTMENTS_MISSING'],
 ['wrong department id type',['123'],undefined,'ORG_DEPARTMENT_ID_INVALID'],
 ['missing parent',['od-team'],async()=>({}),'ORG_PARENT_MISSING'],
 ['cyclic ancestry',['od-team'],async()=>({parent_department_id:'od-team'}),'ORG_ANCESTRY_CYCLE'],
 ['unverified business membership',['od-outside'],undefined,'ORG_BUSINESS_ROOT_UNMATCHED'],
 ['upstream department failure',['od-team'],async()=>{throw Object.assign(Error('secret response'),{response:{status:403,data:{code:99991672,secret:'DO_NOT_LOG'},headers:{'x-tt-logid':'upstream-trace'}}})},'ORG_DEPARTMENT_LOOKUP_FAILED'],
])test(name+' has an actionable diagnostic and never grants access',async()=>{
 const f=fixture(ids,lookup);let error;try{await f.service.syncSingleUser('user-test')}catch(e){error=e}
 assert.equal(error?.errorCode,code);assert.ok(error.diagnosticId);assert.equal(error.diagnostic.feishuUserId,'user-test');assert.ok(error.diagnostic.location.includes('classifyLoginDepartments'));assert.ok(error.suggestion);
 const saved=JSON.parse(f.logs[0].error);assert.equal(saved.diagnosticId,error.diagnosticId);assert.equal(saved.errorCode,code);assert.equal(f.writes,0);
 if(code==='ORG_DEPARTMENT_LOOKUP_FAILED'){assert.equal(error.diagnostic.upstreamStatus,403);assert.equal(error.diagnostic.upstreamCode,99991672);assert.equal(error.diagnostic.upstreamRequestId,'upstream-trace');assert.ok(!JSON.stringify(saved).includes('DO_NOT_LOG'));}
});
test('HTTP error and persisted sync record share a diagnostic id; private context stays in logs',async t=>{
 const f=fixture([]);let error;try{await f.service.syncSingleUser('user-test')}catch(e){error=e}
 const logger=require('../src/common/runtime-logger');let logged;t.mock.method(logger,'writeErrorLog',(message,meta)=>logged=meta);
 const {AllExceptionsFilter}=require('../src/common/all-exceptions.filter');let body,status;
 new AllExceptionsFilter().catch(error,{switchToHttp:()=>({getRequest:()=>({method:'GET',originalUrl:'/api/auth/feishu/callback?code=SECRET',socket:{}}),getResponse:()=>({status:n=>{status=n;return {json:v=>body=v}}})})});
 assert.equal(status,500);assert.equal(body.diagnosticId,error.diagnosticId);assert.equal(body.errorCode,'ORG_DEPARTMENTS_MISSING');assert.equal(logged.diagnostic.feishuUserId,'user-test');assert.equal(logged.diagnosticId,error.diagnosticId);assert.ok(!JSON.stringify(body).includes('user-test'));assert.ok(!JSON.stringify(logged).includes('SECRET'));
});

test('invalid root configuration identifies the exact setting before directory traversal',async()=>{
 for(const [key,code] of [['FEISHU_READONLY_ROOT_DEPTS','ORG_READONLY_ROOT_INVALID'],['FEISHU_SYNC_ROOT_DEPT','ORG_BUSINESS_ROOT_INVALID']]){
  const old=process.env[key];process.env[key]='123';const f=fixture(['od-team'],()=>assert.fail('must validate config first'));
  try{await assert.rejects(()=>f.service.syncSingleUser('user-test'),e=>e.errorCode===code&&e.suggestion.includes(key));}finally{process.env[key]=old}
 }
});
test('excessive ancestry is bounded and reports the walked chain',async()=>{
 let calls=0;const f=fixture(['od-0'],async()=>({parent_department_id:'od-'+(++calls)}));
 await assert.rejects(()=>f.service.syncSingleUser('user-test'),e=>e.errorCode==='ORG_ANCESTRY_LIMIT'&&e.diagnostic.ancestry.length===100);assert.equal(calls,100);
});
test('user lookup failures identify the step without logging upstream secrets',async()=>{
 const f=fixture([]);f.service.feishu.getUser=async()=>{throw Object.assign(Error('Bearer SECRET'),{feishuCode:99991672})};
 await assert.rejects(()=>f.service.syncSingleUser('user-test'),e=>e.errorCode==='ORG_USER_LOOKUP_FAILED'&&e.diagnostic.upstreamCode===99991672);
 assert.ok(!f.logs[0].error.includes('SECRET'));assert.equal(JSON.parse(f.logs[0].error).diagnostic.location,'FeishuSyncService.syncSingleUser:getUser');
});
