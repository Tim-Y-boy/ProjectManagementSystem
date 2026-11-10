const {test}=require('node:test');const assert=require('node:assert/strict');
const {createDepartmentWorkflow,reviewWorkflow,transferWorkflow}=require('../src/modules/closures/closure-workflow');
const reviews=[1,2].map(departmentId=>({departmentId,departmentName:`部门${departmentId}`,ruleId:departmentId,userId:10,name:'同一负责人',status:'pending',checklist:['是否完成']}));
test('department workflow retains two responsibilities for same person',()=>{
 const w=createDepartmentWorkflow(reviews,undefined);assert.equal(w.reviews.length,2);
 assert.throws(()=>reviewWorkflow(w,10,true,'已核查','2026-10-20',[]),/清单/);
 reviewWorkflow(w,10,true,'已核查','2026-10-20',reviews.map(r=>({departmentId:r.departmentId,items:[{answer:'yes',note:''}]})));
 assert.equal(w.stage,'final');assert.ok(w.reviews.every(r=>r.checklistResults.length===1));
});
test('not applicable requires reason; not compliant cannot approve; transfer prohibited',()=>{
 const w=createDepartmentWorkflow(reviews);
 assert.throws(()=>reviewWorkflow(w,10,true,'核查','now',reviews.map(r=>({departmentId:r.departmentId,items:[{answer:'na',note:''}]}))),/不适用/);
 assert.throws(()=>reviewWorkflow(w,10,true,'核查','now',reviews.map(r=>({departmentId:r.departmentId,items:[{answer:'no',note:'未完成'}]}))),/不符合/);
 assert.throws(()=>transferWorkflow(w,10,20,[],30,40,'转交','now'),/部门负责人/);
 assert.equal(w.reviews[0].status,'pending');
});
test('new submissions never reuse prior approvals, empty scope enters final',()=>{
 const old={snapshot:{workflow:{round:1,reviews:reviews.map(r=>({...r,status:'approved'}))}}};
 assert.equal(createDepartmentWorkflow(reviews,old).reviews[0].status,'pending');
 assert.equal(createDepartmentWorkflow([],old).stage,'final');
});
test('rejection retains partially filled checklist while approval requires every answer',()=>{
 const make=()=>createDepartmentWorkflow([{...reviews[0],checklist:['设备验收','培训记录']}]);
 const partial=[{departmentId:1,items:[{answer:'no',note:'设备未验收'},{answer:'',note:''}]}];
 assert.throws(()=>reviewWorkflow(make(),10,true,'请整改','now',partial),/清单/);
 const w=make();
 reviewWorkflow(w,10,false,'设备尚未验收，请整改','now',partial);
 assert.equal(w.reviews[0].status,'rejected');
 assert.deepEqual(w.reviews[0].checklistResults,partial[0].items);
});
