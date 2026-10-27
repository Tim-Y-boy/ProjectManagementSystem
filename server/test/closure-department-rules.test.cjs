const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initialReviewRules, resolveDepartmentScope, validateRule, canManageRules } = require('../src/modules/closures/closure-department-rules');
const rules = () => initialReviewRules().map(r=>({...r,departmentId:r.id}));
const departments = Array.from({length:8},(_,i)=>({id:i+1,name:`部门${i+1}`,head_user_id:100+i,head_name:`负责人${i+1}`,is_active:true}));
const answers = rules().filter(r=>r.mode==='conditional').map(r=>({ruleId:r.id,answer:'no',reason:''}));
test('eight defaults include production checklist and protected HR',()=>{
 assert.equal(rules().length,8); assert.equal(rules()[7].departmentName,'生产部'); assert.equal(rules()[7].checklist.length,5);
 assert.equal(rules()[2].mode,'required');assert.throws(()=>validateRule({...rules()[2],mode:'conditional'},rules()[2]),/HR/);
});
test('project department excluded before AI decisions, including HR; empty scope permits final',()=>{
 const a=resolveDepartmentScope(rules(),departments,8,answers.filter(a=>a.ruleId!==8),107,2);
 assert.deepEqual(a.reviews.map(r=>r.departmentId),[3]); assert.equal(a.excluded[0].departmentId,8);
 assert.equal(resolveDepartmentScope(rules(),departments,3,answers,102,2).reviews.length,0);
});
test('added rules require explicit answers and use their department head',()=>{
 const extra={...rules()[0],id:9,departmentId:9,departmentName:'新增部'};
 assert.throws(()=>resolveDepartmentScope([...rules(),extra],departments,8,answers,1,2),/确认/);
 const d=[...departments,{id:9,name:'新增部',head_user_id:909,head_name:'新增负责人',is_active:true}];
 const result=resolveDepartmentScope([...rules(),extra],d,8,[...answers,{ruleId:9,answer:'yes'}],1,2);
 assert.equal(result.reviews.find(r=>r.departmentId===9).userId,909);
});
test('cannot submit unresolved rules, inactive head, self review or unknown rules',()=>{
 assert.throws(()=>resolveDepartmentScope(rules(),departments,8,[],1,2),/确认/);
 assert.throws(()=>resolveDepartmentScope(rules(),departments,8,answers,1,102),/身份冲突/);
 assert.throws(()=>resolveDepartmentScope(rules(),departments.map(d=>({...d,is_active:false})),8,answers,1,2),/负责人/);
 assert.throws(()=>resolveDepartmentScope(rules(),departments,8,[...answers,{ruleId:999,answer:'no'}],1,2),/规则/);
});
test('only department heads and higher can manage rules',()=>{
 for(const role of ['admin','leader','dept_head'])assert.equal(canManageRules([role]),true);
 assert.equal(canManageRules(['member']),false);
});

test('manual yes/no answers add only selected conditional heads and keep mandatory reviewers',()=>{
 const selected=answers.map(d=>({...d,answer:[1,4,5].includes(d.ruleId)?'yes':'no'}));
 const result=resolveDepartmentScope(rules(),departments,8,selected,999,2);
 assert.deepEqual(result.reviews.map(r=>r.departmentId),[1,3,4,5,8]);
 for(const review of result.reviews) {
  assert.equal(review.userId,departments.find(d=>d.id===review.departmentId).head_user_id);
  assert.deepEqual(review.checklist,rules().find(r=>r.departmentId===review.departmentId).checklist);
 }
 assert.throws(()=>resolveDepartmentScope(rules(),departments,8,selected.filter(d=>d.ruleId!==6),999,2),/确认/);
});
