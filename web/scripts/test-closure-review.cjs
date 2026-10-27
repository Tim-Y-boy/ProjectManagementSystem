const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');const vm=require('vm');const ts=require('typescript');const vue=require('vue');const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc');
function setup(file,props,userId=1){
 const full=path.resolve(__dirname,'../src/components/closures',file);const source=fs.readFileSync(full,'utf8');const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 const script=compileScript(descriptor,{id:'closure-review-test'});const code=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
 const mod={exports:{}};const calls=[];const warnings=[];
 const api={uploadCharter:async()=>({id:7,original_name:'charter.pdf'}),approve:async(...args)=>calls.push(['approve',...args]),reject:async(...args)=>calls.push(['reject',...args]),transfer:async(...args)=>calls.push(['transfer',...args])};
 const req=id=>id==='@/api'?{closuresApi:api}:id==='@/stores/auth'?{useAuthStore:()=>({user:{id:userId}})}:id==='element-plus'?{ElMessage:{warning:x=>warnings.push(x),error:x=>warnings.push(x),success:()=>{}}}:id==='@/utils/date-time'?{formatBeijingTime:x=>x}:require(id);
 vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(req,mod,mod.exports);
 const c=mod.exports.default.setup(props,{expose:()=>{},emit:(...args)=>calls.push(args)});
 return {c,calls,warnings};
}
const candidates=[{id:1,name:'负责人'},{id:2,name:'总经理'},{id:3,name:'A'},{id:4,name:'B'}];
const preview=()=>({project:{id:1},ready:true,approverId:2,approverName:'总经理',reviewerCandidates:candidates});
test('application validates narrative and charter alternative before emitting payload',()=>{
 const {c,calls,warnings}=setup('ClosureApplicationForm.vue',{preview:preview(),saving:false});
 c.submit();assert.equal(calls.length,0);assert.match(warnings[0],/背景/);
 Object.assign(c.form,{background:'背景',objective:'目标',outcome:'成果',reviewerIds:[3]});c.submit();assert.equal(calls.length,0);
 c.noCharter.value=true;c.form.noCharterReason='历史无书';c.submit();assert.equal(calls[0][0],'submit');assert.deepEqual(calls[0][1].charterFileIds,[]);
 assert.match(c.disabledReason({id:2}),/总经理/);assert.match(c.disabledReason({id:1}),/申请人/);
});
test('retry retains original reviewer ids and restores uploaded charter metadata',()=>{
 const p=preview();p.previous={status:'rejected',snapshot:{application:{background:'旧背景',objective:'目标',outcome:'成果',charters:[{id:7,original_name:'old.pdf'}]},workflow:{reviews:[{userId:3,name:'A'}]}}};
 const {c}=setup('ClosureApplicationForm.vue',{preview:p,saving:false});assert.deepEqual([...c.form.reviewerIds],[3]);assert.equal(c.files.value[0].id,7);assert.equal(c.form.background,'旧背景');assert.match(c.disabledReason({id:3}),/原审核人/);
});
test('inactive original reviewers can be replaced instead of trapping the form',()=>{
 const p=preview();p.previous={status:'rejected',snapshot:{workflow:{reviews:[{userId:8,name:'已停用'}]}}};
 const {c}=setup('ClosureApplicationForm.vue',{preview:p,saving:false});assert.deepEqual([...c.form.reviewerIds],[]);assert.equal(c.unavailableReviews.value.length,1);
});
test('peer reviewer requires opinion and transfer candidates exclude requester, GM and assigned people',async()=>{
 const request={id:8,status:'pending',requester_id:1,approver_id:2,reviewerCandidates:[...candidates,{id:5,name:'C'}],snapshot:{workflow:{stage:'reviewers',reviews:[{userId:3,status:'pending'},{userId:4,status:'approved'}]}}};
 const {c,calls}=setup('ClosureReviewPanel.vue',{request},3);assert.equal(c.mine.value,true);assert.deepEqual(c.candidates.value.map(p=>p.id),[5]);
 await c.decide(true);assert.equal(calls.length,0);c.comment.value='已核实';await c.decide(true);assert.deepEqual(calls[0],['approve',8,'已核实']);
 c.target.value=5;c.reason.value='实际负责同事';await c.transfer();assert.ok(calls.some(v=>v[0]==='transfer'&&v[2]===5));
 assert.equal(setup('ClosureReviewPanel.vue',{request},2).c.mine.value,false);
});
test('task detail defaults to progress and retains actions without overview tab',()=>{
 const source=fs.readFileSync(path.resolve(__dirname,'../src/views/Tasks.vue'),'utf8');const d=parse(source).descriptor;
 assert.doesNotMatch(d.template.content,/label="任务概况"/);assert.match(source,/detailTab = shallowRef\('updates'\)/);assert.match(d.template.content,/提交验收/);
 assert.deepEqual(compileTemplate({source:d.template.content,filename:'Tasks.vue',id:'task-detail-test'}).errors,[]);
});
