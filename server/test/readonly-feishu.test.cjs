const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const axios=require('axios');
const {FeishuNotifyService}=require('../src/modules/feishu/feishu-notify.service');
const {FeishuSyncService}=require('../src/modules/feishu/feishu-sync.service');
const envKeys=['FEISHU_NOTIFY_DISABLED','FEISHU_GROUP_NOTIFY_DISABLED','FEISHU_NOTIFY_REDIRECT_USER_ID','FEISHU_READONLY_ROOT_DEPTS','FEISHU_READONLY_USER_IDS'];
let envSaved;beforeEach(()=>{envSaved=envKeys.map(k=>process.env[k]);envKeys.forEach(k=>delete process.env[k]);});afterEach(()=>envKeys.forEach((k,i)=>envSaved[i]===undefined?delete process.env[k]:process.env[k]=envSaved[i]));
test('readonly original and redirect recipient suppress personal delivery without persistence',async()=>{
 const old=axios.post; let calls=0,saves=0;axios.post=async()=>{calls++;return {data:{code:0}}};
 const prev=process.env.FEISHU_NOTIFY_REDIRECT_USER_ID;process.env.FEISHU_NOTIFY_REDIRECT_USER_ID='2';
 try{for(const readonly of [1,2]){const s=new FeishuNotifyService({create:v=>v,save:async v=>{saves++;return v}},{findOne:async({where})=>({id:where.id,readOnly:where.id===readonly,openId:'ou_test'})},{isConfigured:()=>true,getTenantAccessToken:async()=>''});s.logger={warn(){},error(){}};const n=await s.send('test',1,'x');assert.equal(n.response?.reason,'readonly');assert.equal(n.response?.skipped,true);}assert.equal(calls,0);assert.equal(saves,0);}finally{axios.post=old;prev===undefined?delete process.env.FEISHU_NOTIFY_REDIRECT_USER_ID:process.env.FEISHU_NOTIFY_REDIRECT_USER_ID=prev;}
});
test('readonly branches win multiple departments and protection persists after config removal',async()=>{
 const prev=process.env.FEISHU_READONLY_ROOT_DEPTS;const root=process.env.FEISHU_SYNC_ROOT_DEPT;process.env.FEISHU_READONLY_ROOT_DEPTS='od-ro';process.env.FEISHU_SYNC_ROOT_DEPT='od-business';
 const rows=new Map(),ds=new Map();const users={findOne:async({where})=>rows.get(where.feishuUserId)||null,create:v=>v,save:async v=>{rows.set(v.feishuUserId,v);return v}};const depts={upsert:async v=>ds.set(v.feishuDeptId,{id:ds.size+1,...v}),findOne:async({where})=>ds.get(where.feishuDeptId),find:async()=>[]};
 const f={isConfigured:()=>true,listDepartments:async id=>[{open_department_id:id,name:'dept'}],listUsersByDepartment:async()=>[{user_id:'multi',department_ids:['od-business','od-ro']}]};
 const s=new FeishuSyncService(depts,users,{create:v=>v,save:async v=>v},f);
 try{await s.syncFull();assert.equal(rows.get('multi').readOnly,true);delete process.env.FEISHU_READONLY_ROOT_DEPTS;await s.syncFull();assert.equal(rows.get('multi').readOnly,true);}finally{prev===undefined?delete process.env.FEISHU_READONLY_ROOT_DEPTS:process.env.FEISHU_READONLY_ROOT_DEPTS=prev;root===undefined?delete process.env.FEISHU_SYNC_ROOT_DEPT:process.env.FEISHU_SYNC_ROOT_DEPT=root;}
});
test('incomplete readonly enumeration admits no business users', async()=>{
 const prev=process.env.FEISHU_READONLY_ROOT_DEPTS;process.env.FEISHU_READONLY_ROOT_DEPTS='od-ro';let writes=0;
 const s=new FeishuSyncService({upsert:async()=>writes++},{save:async()=>writes++},{create:v=>v,save:async v=>v},{isConfigured:()=>true,listDepartments:async()=>{throw new Error('partial directory')}});s.logger={error(){}};
 try{await assert.rejects(()=>s.syncFull(),/partial directory/);assert.equal(writes,0);}finally{prev===undefined?delete process.env.FEISHU_READONLY_ROOT_DEPTS:process.env.FEISHU_READONLY_ROOT_DEPTS=prev;}
});
test('readonly blocks text and card retries; group sends remain supported', async()=>{
 const post=axios.post;let calls=0,readonly=false;axios.post=async()=>{calls++;readonly=true;throw Error('retry')};
 const s=new FeishuNotifyService({create:v=>v,save:async v=>v},{findOne:async()=>({readOnly:readonly,openId:'ou_test'})},{isConfigured:()=>true,getTenantAccessToken:async()=>''});s.logger={warn(){},error(){}};s.wait=async()=>{};
 try{const result=await s.sendCard('test',1,{},'test');assert.equal(calls,1);assert.equal(result.response.reason,'readonly');assert.equal(result.retryCount,0);await s.send('test',1,'test');assert.equal(calls,1);axios.post=async()=>{calls++;return {data:{code:0}}};assert.equal((await s.sendGroupCard('test','oc_test',{},'test')).success,true);assert.equal(calls,2);}finally{axios.post=post;}
});
test('readonly review cards terminate without outbound updates',async()=>{
 const patch=axios.patch;axios.patch=async()=>assert.fail('no outbound patch');let sync;
 const row={id:1,recipientId:1,response:{data:{message_id:'om_test'}}};const qb={getMany:async()=>[row]};for(const m of ['where','andWhere','orderBy','addOrderBy','take'])qb[m]=()=>qb;
 const s=new FeishuNotifyService({createQueryBuilder:()=>qb,update:async(_,v)=>{sync=v.response.reviewSync},query:()=>assert.fail('no business lookup')},{findOne:async()=>({readOnly:true})},{isConfigured:()=>true});s.logger={warn(){}};
 try{await s.syncReviewCards();assert.equal(sync.done,true);assert.equal(sync.reason,'readonly');}finally{axios.patch=patch;}
});
test('readonly notification remains suppressed when local delivery is disabled',async()=>{
 process.env.FEISHU_NOTIFY_DISABLED='true';
 const s=new FeishuNotifyService({create:v=>v,save:()=>assert.fail('no personal notification row')},{findOne:async()=>({readOnly:true})},{getTenantAccessToken:()=>assert.fail('no token')});
 const n=await s.send('test',1,'test');assert.equal(n.response.reason,'readonly');
});
test('explicit protected leaders outside readonly branches persist protection',async()=>{
 process.env.FEISHU_READONLY_USER_IDS='external-leader';let saved;
 const s=new FeishuSyncService({find:async()=>[]},{findOne:async()=>null,create:v=>v,save:async v=>saved=v},{create:v=>v,save:async v=>v},{isConfigured:()=>true,listDepartments:async()=>[],getUser:async()=>({user_id:'external-leader'})});
 await s.syncFull();assert.equal(saved.feishuUserId,'external-leader');assert.equal(saved.readOnly,true);
});
test('business-listed secondary membership is protected even if readonly listing omits it',async()=>{
 process.env.FEISHU_READONLY_ROOT_DEPTS='od-ro';process.env.FEISHU_SYNC_ROOT_DEPT='od-business';let saved;const ds=new Map();
 const s=new FeishuSyncService({upsert:async d=>ds.set(d.feishuDeptId,{id:1,...d}),findOne:async({where})=>ds.get(where.feishuDeptId),find:async()=>[]},{findOne:async()=>saved,create:v=>v,save:async v=>saved=v},{create:v=>v,save:async v=>v},{isConfigured:()=>true,listDepartments:async id=>[{open_department_id:id}],listUsersByDepartment:async id=>id==='od-ro'?[]:[{user_id:'secondary',department_ids:['od-business','od-ro']}]});
 await s.syncFull();assert.equal(saved.readOnly,true);
});
test('single login rejects unclassifiable membership and permits known business or readonly membership',async()=>{
 process.env.FEISHU_READONLY_ROOT_DEPTS='od-ro';process.env.FEISHU_SYNC_ROOT_DEPT='od-business';let input, saved;
 const s=new FeishuSyncService({findOne:async()=>null},{findOne:async()=>null,create:v=>v,save:async v=>saved=v},{create:v=>v,save:async v=>v},{isConfigured:()=>true,listDepartments:async()=>assert.fail('login must not enumerate departments'),listUsersByDepartment:async()=>assert.fail('login must not enumerate members'),getDepartment:async id=>({open_department_id:id,parent_department_id:'0'}),getUser:async()=>input});
 for(const departments of [undefined,[],['od-unknown']]){input={user_id:'login',department_ids:departments};await assert.rejects(()=>s.syncSingleUser('login'),/组织归属校验失败/);assert.equal(saved,undefined);}
 input={user_id:'login',department_ids:['od-business']};await s.syncSingleUser('login');assert.equal(saved.readOnly,false);
 input={user_id:'login',department_ids:['od-business','od-ro']};await s.syncSingleUser('login');assert.equal(saved.readOnly,true);
});

test('single login walks ancestors and protects secondary branches without member scans',async()=>{
 process.env.FEISHU_READONLY_ROOT_DEPTS='od-ro';process.env.FEISHU_SYNC_ROOT_DEPT='od-business';let saved;const calls=[];
 const s=new FeishuSyncService({findOne:async()=>null},{findOne:async()=>null,create:v=>v,save:async v=>saved=v},{create:v=>v,save:async v=>v},{isConfigured:()=>true,getUser:async()=>({user_id:'login',department_ids:['od-team','od-protected']}),getDepartment:async id=>{calls.push(id);return {parent_department_id:{'od-team':'od-business','od-business':'0','od-protected':'od-ro'}[id]};},listDepartments:async()=>assert.fail('no scan'),listUsersByDepartment:async()=>assert.fail('no scan')});
 await s.syncSingleUser('login');assert.equal(saved.readOnly,true);assert.deepEqual(calls,['od-team','od-business','od-protected']);
});
test('single login fails closed on broken or cyclic ancestry',async()=>{
 process.env.FEISHU_READONLY_ROOT_DEPTS='od-ro';
 for(const parent of [undefined,'od-loop']){
 const s=new FeishuSyncService({}, {findOne:async()=>null,save:async()=>assert.fail('no write')},{create:v=>v,save:async v=>v},{isConfigured:()=>true,getUser:async()=>({user_id:'login',department_ids:['od-loop']}),getDepartment:async()=>({parent_department_id:parent})});
 await assert.rejects(()=>s.syncSingleUser('login'),/组织归属校验失败/);
 }
});

test('business membership permits concurrent external affiliations while readonly still wins',async()=>{
 const previous=process.env.FEISHU_SYNC_ROOT_DEPT;
 process.env.FEISHU_SYNC_ROOT_DEPT='od-business';process.env.FEISHU_READONLY_ROOT_DEPTS='od-ro';
 try {
  for(const ids of [['od-team','od-external'],['od-external','od-team'],['od-team','od-external','od-ro']]) {
   let saved;
   const s=new FeishuSyncService({findOne:async()=>null},{findOne:async()=>null,create:v=>v,save:async v=>saved=v},{create:v=>v,save:async v=>v},{isConfigured:()=>true,getUser:async()=>({user_id:'multi-login',department_ids:ids}),getDepartment:async id=>({parent_department_id:id==='od-team'?'od-business':'0'})});
   await s.syncSingleUser('multi-login');
   assert.equal(saved.readOnly,ids.includes('od-ro'));
  }
 } finally {previous===undefined?delete process.env.FEISHU_SYNC_ROOT_DEPT:process.env.FEISHU_SYNC_ROOT_DEPT=previous;}
});
