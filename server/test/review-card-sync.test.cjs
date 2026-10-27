const { test } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { FeishuNotifyService } = require('../src/modules/feishu/feishu-notify.service');
const initialCard = { config:{wide_screen_mode:true}, header:{template:'orange',title:{tag:'plain_text',content:'计划变更待审核'}}, elements:[{tag:'div',text:{tag:'plain_text',content:'原始申请内容'}},{tag:'action',actions:[{tag:'button',type:'primary',text:{tag:'plain_text',content:'去审核'},url:'https://example.com/plan-changes'}]}] };
function fixture(extra={}, domain={status:'approved',reviewed_at:new Date(),reviewer_name:'审核人'}) {
  const row={id:1,type:'plan_change_submitted',recipientId:3,projectId:9,planChangeId:7,createdAt:new Date(Date.now()-60000),sentAt:new Date(Date.now()-60000),success:true,content:'原始申请内容',response:{code:0,data:{message_id:'om_test'},reviewCard:structuredClone(initialCard),reviewRef:{stage:'final'}},...extra};
  const updates=[],patches=[],queries=[];
  const qb={getMany:async()=>row.response.reviewSync?.done ? [] : [row]};
  for(const key of ['where','andWhere','orderBy','addOrderBy','take'])qb[key]=()=>qb;
  const repo={create:v=>v,save:async v=>v,createQueryBuilder:()=>qb,update:async(id,change)=>{updates.push(change);Object.assign(row,change);},query:async(sql,args)=>{queries.push([sql,args]);return domain ? [domain] : [];}};
  const service=new FeishuNotifyService(repo,{findOne:async()=>({openId:'ou_test'})},{isConfigured:()=>true,getTenantAccessToken:async()=> 'test-token'});
  service.logger={warn(){},error(){}};
  return {row,service,updates,patches,queries};
}
async function network(fn){
  const patch=axios.patch,post=axios.post;
  const keys=['FEISHU_NOTIFY_DISABLED','FEISHU_NOTIFY_REDIRECT_USER_ID'];const saved=keys.map(k=>process.env[k]);
  keys.forEach(k=>delete process.env[k]);
  const patches=[];axios.patch=async(...args)=>{patches.push(args);return {data:{code:0}}};axios.post=async()=>assert.fail('must update original card, never send a duplicate');
  try{await fn(patches);}finally{axios.patch=patch;axios.post=post;keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}
}
test('approval patches the original message, retains content and link, and is idempotent',async()=>network(async patches=>{
  const f=fixture();await f.service.syncReviewCards();assert.equal(patches.length,1);assert.match(patches[0][0],/messages[/]om_test$/);
  const card=JSON.parse(patches[0][1].content);assert.equal(card.config.update_multi,true);
  assert.match(JSON.stringify(card),/已审核.*已通过/);assert.doesNotMatch(JSON.stringify(card),/去审核/);assert.match(JSON.stringify(card),/原始申请内容/);
  assert.equal(card.elements.find(e=>e.tag==='action').actions[0].url,'https://example.com/approvals?changeId=7');
  assert.equal(f.row.response.data.message_id,'om_test');await f.service.syncReviewCards();assert.equal(patches.length,1);
}));
test('pending approval leaves the action unchanged; rejection and withdrawal have distinct results',async()=>network(async patches=>{
  await fixture({}, {status:'pending',stage:'final'}).service.syncReviewCards();assert.equal(patches.length,0);
  for(const [status,text] of [['rejected','已退回'],['cancelled','已撤回']]){await fixture({}, {status,reviewed_at:new Date()}).service.syncReviewCards();assert.match(patches.at(-1)[1].content,new RegExp(text));}
}));
test('owner-stage card completes when passed to final review, without completing the final-review card',async()=>network(async patches=>{
  const f=fixture({}, {status:'pending',stage:'final',owner_approved_at:new Date(),owner_name:'负责人'});f.row.response.reviewRef.stage='owner';
  await f.service.syncReviewCards();assert.equal(patches.length,1);assert.match(patches[0][1].content,/已转终审/);
  const final=fixture({type:'plan_change_owner_approved'},{status:'pending',stage:'final',owner_approved_at:new Date()});await final.service.syncReviewCards();assert.equal(patches.length,1);
}));
test('task acceptance uses the first review after that notification, even after a later resubmission',async()=>network(async patches=>{
  const f=fixture({type:'task_submitted_acceptance',taskId:266,planChangeId:null},{to_status:'doing',created_at:new Date(),reviewer_name:'验收人'});
  await f.service.syncReviewCards();assert.match(patches[0][1].content,/已退回/);
  const link = new URL(JSON.parse(patches[0][1].content).elements.find(e=>e.tag==='action').actions[0].url);
  assert.equal(link.pathname,'/approvals'); assert.equal(link.searchParams.get('taskId'),'266'); assert.ok(link.searchParams.get('at'));
  assert.match(f.queries[0][0],/from_status='pending_accept'/);assert.match(f.queries[0][0],/ORDER BY.*created_at.*ASC/s);
}));
test('closure and reopen review resolve by the specific notice id',async()=>network(async patches=>{
  for(const type of ['closure_review','reopen_review']){const f=fixture({type,planChangeId:null},{status:'approved',reviewed_at:new Date()});f.row.response.reviewRef={noticeId:42};await f.service.syncReviewCards();assert.equal(f.queries[0][1][0],42);}
  assert.equal(patches.length,2);
}));
test('patch failures retain successful send metadata and remain retryable',async()=>network(async patches=>{
  const f=fixture();axios.patch=async()=>{throw Error('temporary network failure');};await f.service.syncReviewCards();
  assert.equal(f.row.success,true);assert.equal(f.row.response.data.message_id,'om_test');assert.notEqual(f.row.response.reviewSync?.done,true);
  axios.patch=async(...args)=>{patches.push(args);return {data:{code:0}}};await f.service.syncReviewCards();assert.equal(patches.length,1);assert.equal(f.row.response.reviewSync.done,true);
}));
test('disabled notifications and local redirect cannot update real recipient cards',async()=>network(async patches=>{
  process.env.FEISHU_NOTIFY_DISABLED='true';await fixture().service.syncReviewCards();
  delete process.env.FEISHU_NOTIFY_DISABLED;process.env.FEISHU_NOTIFY_REDIRECT_USER_ID='99';await fixture().service.syncReviewCards();assert.equal(patches.length,0);
}));
test('cards without message ids are never sent as replacements',async()=>network(async patches=>{
  const f=fixture();delete f.row.response.data.message_id;await f.service.syncReviewCards();assert.equal(patches.length,0);
}));

test('closure peer cards follow their own review or transfer and stop on withdrawn requests',async()=>network(async patches=>{
  const cases=[
    {status:'pending',events:[],expected:null},
    {status:'pending',events:[{type:'approved',userId:3,name:'A',at:new Date()}],expected:'已通过'},
    {status:'rejected',events:[{type:'rejected',userId:3,name:'A',at:new Date()}],expected:'已退回'},
    {status:'pending',events:[{type:'transfer',from:3,fromName:'A',to:4,toName:'B',at:new Date()}],expected:'已转交'},
    {status:'withdrawn',events:[],expected:'本次审核已结束'},
    {status:'rejected',events:[{type:'rejected',userId:4,name:'B',at:new Date()}],expected:'本次审核已结束'},
  ];
  for(const item of cases){
    const before=patches.length;
    const f=fixture({type:'closure_peer_review',planChangeId:null},{status:item.status,reviewed_at:new Date(),snapshot:{workflow:{events:item.events}},payload:{reviewerId:3,eventIndex:0}});
    f.row.response.reviewRef={noticeId:43};await f.service.syncReviewCards();
    assert.equal(patches.length,before+(item.expected?1:0));
    if(item.expected)assert.match(patches.at(-1)[1].content,new RegExp(item.expected));
  }
}));
