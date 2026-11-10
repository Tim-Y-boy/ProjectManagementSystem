const {test}=require('node:test');
const assert=require('node:assert/strict');
const axios=require('axios');
const {FeishuNotifyService}=require('../src/modules/feishu/feishu-notify.service');
test('explicit local group forwarding sends only to tester; missing redirect never reaches a group',async()=>{
 const keys=['FEISHU_NOTIFY_DISABLED','FEISHU_GROUP_NOTIFY_DISABLED','FEISHU_NOTIFY_REDIRECT_USER_ID','FEISHU_GROUP_NOTIFY_REDIRECT'];
 const saved=keys.map(k=>process.env[k]);const post=axios.post;const calls=[];
 Object.assign(process.env,{FEISHU_NOTIFY_DISABLED:'false',FEISHU_GROUP_NOTIFY_DISABLED:'true',FEISHU_NOTIFY_REDIRECT_USER_ID:'1',FEISHU_GROUP_NOTIFY_REDIRECT:'true'});
 const s=new FeishuNotifyService({create:v=>v,save:async v=>v},{findOne:async()=>({openId:'ou_tester',readOnly:false})},{isConfigured:()=>true,getTenantAccessToken:async()=>'fake'});
 s.logger={warn(){},error(){}};
 axios.post=async(...args)=>{calls.push(args);return {data:{code:0}}};
 try{
  const result=await s.sendGroupCard('group_test','oc_real',{},'summary');
  assert.equal(result.success,true);assert.equal(calls.length,1);
  assert.equal(calls[0][1].receive_id,'ou_tester');assert.equal(calls[0][2].params.receive_id_type,'open_id');
  delete process.env.FEISHU_NOTIFY_REDIRECT_USER_ID;
  const blocked=await s.sendGroupCard('group_test','oc_real',{},'summary');
  assert.equal(blocked.success,false);assert.equal(calls.length,1);
 }finally{axios.post=post;keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}
});
