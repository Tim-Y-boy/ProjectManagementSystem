const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {parse}=require('@vue/compiler-sfc');
function run(source, context, expose) {
  const tree=ts.createSourceFile('source.ts',source,ts.ScriptTarget.Latest,true);
  const code=tree.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportAssignment(n)).map(n=>n.getText(tree)).join('\n');
  vm.runInNewContext(ts.transpileModule(code+'\n;globalThis.subject={'+expose+'};',{compilerOptions:{target:ts.ScriptTarget.ES2021}}).outputText,context);
  return context.subject;
}
test('related records load explicitly and detail keeps list tab and immutable log ID on desktop/mobile',async()=>{
  for(const routePath of ['/approvals','/mobile/approve']) {
    const route={path:routePath,query:{view:'related'},meta:{}};const calls=[],navigations=[];
    const source=parse(fs.readFileSync(path.join(__dirname,'../src/views/Approvals.vue'),'utf8')).descriptor.scriptSetup.content;
    const subject=run(source,{ref:value=>({value}),computed:fn=>({get value(){return fn();}}),watch(){},onActivated(){},
      useRoute:()=>route,useRouter:()=>({push:v=>navigations.push(v)}),useRefreshStore:()=>({versions:{}}),dashboardApi:{approvalRecords:async v=>{calls.push(v);return []; }},window:{location:{origin:'http://localhost'}},URL},'load,openRecord,hasDetail');
    await subject.load();assert.deepEqual(calls,['related']);
    subject.openRecord({path:'/approvals?view=related&taskLogId=43'});
    assert.equal(navigations[0].path,routePath);assert.equal(navigations[0].query.taskLogId,'43');assert.equal(navigations[0].query.view,'related');
    route.query={view:'mine',taskLogId:'43'};assert.equal(subject.hasDetail.value,true);
    route.query={view:'mine'};assert.equal(subject.hasDetail.value,false);
  }
});
test('legacy plan-change routes redirect to the unified desktop/mobile approval detail preserving identity',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/router/index.ts'),'utf8');
  const {routes}=run(source,{createWebHistory:()=>({}),createRouter:()=>({beforeEach(){}})},'routes');
  for(const [parent,target] of [['/','/approvals'],['/mobile','/mobile/approve']]) {
    const legacy=routes.find(r=>r.path===parent).children.find(r=>r.path==='plan-changes');
    const result=legacy.redirect({query:{changeId:'12'},hash:'#change-12'});
    assert.equal(result.path,target);assert.equal(result.query.changeId,'12');assert.equal(result.query.view,'related');assert.equal(result.hash,'#change-12');
  }
});
