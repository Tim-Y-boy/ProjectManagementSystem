const {test}=require('node:test');
const assert=require('node:assert/strict');
const {operationChangeEvents}=require('../src/modules/tasks/operation-change-events');
const change={id:12,projectId:1,requesterId:2,approverId:3,status:'approved',createdAt:'2026-10-26T09:11:00Z',reviewedAt:'2026-10-26T09:11:42Z',reason:'需求待明确'};
const item={id:10,changeId:12,taskId:8,changeType:'delete',before:{title:'日常任务管控'},after:{}};
test('historical cancellation separates requester and actual approver without duplicate approval or changing status at submission',()=>{
 const stored={id:20,taskId:8,operatorId:3,action:'plan_change',createdAt:change.reviewedAt,fromStatus:'doing',toStatus:'cancelled',payload:{changeId:12,changeType:'delete'}};
 const events=operationChangeEvents([stored],[change],[item]);
 assert.equal(events.length,2);
 const request=events.find(e=>e.action==='plan_change_request');
 assert.equal(request.operatorId,2);assert.equal(request.createdAt,change.createdAt);assert.equal(request.toStatus,null);
 const approval=events.find(e=>e.action==='plan_change_approve');
 assert.equal(approval.operatorId,3);assert.equal(approval.toStatus,'cancelled');assert.equal(approval.payload.reason,'需求待明确');
 assert.equal(stored.action,'plan_change');
});
test('pending request has no fabricated approval; owner approval and rejection retain their own actors and timestamps',()=>{
 assert.equal(operationChangeEvents([],[{...change,status:'pending',approverId:null,reviewedAt:null}],[item]).length,1);
 const events=operationChangeEvents([],[{...change,status:'rejected',ownerApproverId:4,ownerApprovedAt:'2026-10-26T09:11:20Z'}],[item]);
 assert.deepEqual(events.map(e=>e.action),['plan_change_request','plan_change_owner_approve','plan_change_reject']);
 assert.deepEqual(events.map(e=>e.operatorId),[2,4,3]);
 assert.ok(events.every(e=>e.toStatus===null));
});
