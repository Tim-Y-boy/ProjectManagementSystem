const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateApplication, createWorkflow, reviewWorkflow, transferWorkflow}=require('../src/modules/closures/closure-workflow');
const people=[{id:2,name:'总经理'},{id:3,name:'A'},{id:4,name:'B'},{id:5,name:'C'}];
const body={background:'背景',objective:'目标',outcome:'成果',charterFileIds:[],noCharterReason:'历史项目无立项书',reviewerIds:[3,4]};
const build=(previous,ids=[3,4])=>createWorkflow(ids,people,2,1,previous);
test('application requires charter or explanation and narrative',()=>{
 assert.equal(validateApplication(body).objective,'目标');
 assert.throws(()=>validateApplication({...body,noCharterReason:''}),/立项书/);
 assert.throws(()=>validateApplication({...body,background:' '}),/背景/);
});
test('final reviewer and duplicate or inactive reviewers cannot be added',()=>{
 assert.throws(()=>build(null,[2]),/总经理/); assert.throws(()=>build(null,[3,3]),/重复/);
 assert.throws(()=>build(null,[8]),/有效/); assert.throws(()=>build(null,[]),/至少/);
});
test('ordinary rejection preserves approvals with original dates and new reviewers pending',()=>{
 const w=build(); reviewWorkflow(w,3,true,'已核实','2026-10-13T01:00:00Z'); reviewWorkflow(w,4,false,'需补充','2026-10-13T02:00:00Z');
 const next=build({id:11,status:'rejected',snapshot:{workflow:w}},[3,4,5]);
 assert.equal(next.reviews[0].status,'approved'); assert.equal(next.reviews[0].reviewedAt,'2026-10-13T01:00:00Z');
 assert.equal(next.reviews[0].sourceRequestId,11); assert.equal(next.reviews[1].status,'pending'); assert.equal(next.reviews[2].status,'pending');
 assert.throws(()=>build({id:11,status:'rejected',snapshot:{workflow:w}},[3]),/保留/);
});
test('GM rejection resets every approval even after prior reuse',()=>{
 const w=build(); reviewWorkflow(w,3,true,'通过','2026-10-13T01:00:00Z'); reviewWorkflow(w,4,true,'通过','2026-10-13T02:00:00Z');
 assert.equal(w.stage,'final'); w.finalDecision='rejected';
 const next=build({id:12,status:'rejected',snapshot:{workflow:w}});
 assert.equal(next.round,2); assert.ok(next.reviews.every(r=>r.status==='pending'&&!r.sourceRequestId));
});
test('transfer revokes sender, prevents GM and existing reviewer, records actual reviewer',()=>{
 const w=build(); assert.throws(()=>transferWorkflow(w,3,2,people,2,1,'转交','now'),/总经理/);
 assert.throws(()=>transferWorkflow(w,3,4,people,2,1,'转交','now'),/已在/);
 transferWorkflow(w,3,5,people,2,1,'由C核验','2026-10-13T01:00:00Z');
 assert.throws(()=>reviewWorkflow(w,3,true,'通过','now'),/待审核/);
 reviewWorkflow(w,5,true,'已核验','2026-10-13T02:00:00Z');
 assert.equal(w.reviews[0].name,'C'); assert.equal(w.events[0].from,3);
 assert.throws(()=>reviewWorkflow(w,5,true,'重复','now'),/待审核/);
});
test('unavailable prior reviewer may be replaced without bypassing a required review',()=>{
 const w=build();const previous={id:11,status:'rejected',snapshot:{workflow:w}};
 const active=people.filter(p=>p.id!==3);
 assert.throws(()=>createWorkflow([4],active,2,1,previous),/替代/);
 const next=createWorkflow([4,5],active,2,1,previous);
 assert.equal(next.reviews.find(r=>r.userId===5).status,'pending');assert.equal(next.events[0].from,3);
});
