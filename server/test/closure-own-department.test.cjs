const {test}=require('node:test');const assert=require('node:assert/strict');
const {initialReviewRules,resolveDepartmentScope}=require('../src/modules/closures/closure-department-rules');
const rules=initialReviewRules().map(r=>({...r,departmentId:r.id}));
const departments=rules.map(r=>({id:r.id,name:r.departmentName,head_user_id:100+r.id,head_name:'负责人'+r.id,is_active:true}));
const answers=rules.filter(r=>r.mode==='conditional').map(r=>({ruleId:r.id,answer:'no'}));
test('ordinary owner must have own department head review even AI says no',()=>{
 const result=resolveDepartmentScope(rules,departments,6,answers,1,999);
 assert.deepEqual(result.reviews.map(r=>r.departmentId).sort(),[3,6]);assert.equal(result.excluded.length,0);
 assert.equal(result.reviews.find(r=>r.departmentId===6).userId,106);
});
test('department head owning project avoids self review; HR follows same rule',()=>{
 assert.deepEqual(resolveDepartmentScope(rules,departments,6,answers,106,999).reviews.map(r=>r.departmentId),[3]);
 assert.equal(resolveDepartmentScope(rules,departments,3,answers,103,999).reviews.length,0);
 assert.equal(resolveDepartmentScope(rules,departments,3,answers,1,999).reviews[0].userId,103);
});
test('own department is mandatory despite disabled conditional rule and deduplicates AI yes',()=>{
 const disabled=rules.map(r=>r.id===6?{...r,enabled:false}:r);
 assert.ok(resolveDepartmentScope(disabled,departments,6,answers,1,999).reviews.some(r=>r.departmentId===6));
 assert.equal(resolveDepartmentScope(rules,departments,6,answers.map(a=>({...a,answer:'yes'})),1,999).reviews.filter(r=>r.departmentId===6).length,1);
});
test('missing owner or own head never silently exempts own department',()=>{
 assert.throws(()=>resolveDepartmentScope(rules,departments,6,answers,0,999),/提交人/);
 assert.throws(()=>resolveDepartmentScope(rules,departments.map(d=>d.id===6?{...d,is_active:false}:d),6,answers,106,999),/负责人/);
});
test('actual submitter is skipped even when responsible for another department',()=>{
 assert.ok(resolveDepartmentScope(rules,departments,6,answers,103,999).excluded.some(r=>r.departmentId===3));
});
test('A and B co-own project: submitter skips only self, other head mandatory despite AI no',()=>{
 const a=resolveDepartmentScope(rules,departments,6,answers,106,999,[106,108]);
 assert.deepEqual(a.reviews.map(r=>r.departmentId).sort(),[3,8]);
 const b=resolveDepartmentScope(rules,departments,6,answers,108,999,[106,108]);
 assert.deepEqual(b.reviews.map(r=>r.departmentId).sort(),[3,6]);
 const admin=resolveDepartmentScope(rules,departments,6,answers,1,999,[106,108]);
 assert.deepEqual(admin.reviews.map(r=>r.departmentId).sort(),[3,6,8]);
});
