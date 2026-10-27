const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const {parse,compileScript}=require('@vue/compiler-sfc');const {createSSRApp,h}=require('vue');const {renderToString}=require('@vue/server-renderer');
const { compileTemplate } = require('@vue/compiler-sfc');

test('desktop task detail hides completed return action while closure is frozen', async () => {
  const file = path.join(__dirname, '../src/views/Tasks.vue');
  const source = parse(fs.readFileSync(file, 'utf8')).descriptor.template.content;
  const button = source.match(/<el-button\b[^>]*detail\.canReopenCompleted[^>]*>退回<\/el-button>/)?.[0];
  assert.ok(button, 'real completed-task return button must exist');
  const compiled = compileTemplate({ source: button, filename: file, id: 'closure-return-test' });
  assert.deepEqual(compiled.errors, []);
  const mod = { exports: {} };
  const code = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(require, mod, mod.exports);
  for (const frozen of [false, true]) {
    const app = createSSRApp({ render: mod.exports.render, setup: () => ({
      detail: { status: 'done', canReopenCompleted: true }, isDetailFrozen: frozen, actDetail() {},
    }) });
    app.component('el-button', { setup: (_, { slots }) => () => h('button', slots.default?.()) });
    const html = await renderToString(app);
    assert.equal(html.includes('退回'), !frozen);
  }
});
function reportModule(file) {
 const full=path.resolve(__dirname,'../../server/src/modules/closures',file);
 const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
 const mod={exports:{}};
 const req=id=>id.startsWith('.')?reportModule(path.relative(path.resolve(__dirname,'../../server/src/modules/closures'),path.resolve(path.dirname(full),id+'.ts'))):require(id);
 vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(req,mod,mod.exports);return mod.exports;
}
async function render(file,request,uid=1){
 if(file==='ClosureReport.vue'&&!request.reportHtml) request={...request,reportHtml:reportModule('closure-report.ts').renderClosureReport(request,{embedded:true})};
 const full=path.join(__dirname,'../src/components/closures',file);const {descriptor}=parse(fs.readFileSync(full,'utf8'),{filename:full});
 const script=compileScript(descriptor,{id:'closure-ui-test',inlineTemplate:true});const code=ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
 const mod={exports:{}};const req=id=>id==='@/stores/auth'?{useAuthStore:()=>({user:{id:uid,roles:['member']}})}:id==='@/api'?{closuresApi:{}}:id==='@/utils/date-time'?{formatBeijingTime:v=>v||'—'}:id==='element-plus'?{ElMessage:{},ElMessageBox:{}}:require(id);
 vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(req,mod,mod.exports);
 const app=createSSRApp(mod.exports.default,{request});
 for(const name of ['el-button','el-alert','el-descriptions','el-descriptions-item','el-collapse','el-collapse-item','el-table','el-table-column'])app.component(name,{props:['title','label'],setup:(p,{slots})=>()=>h(name==='el-button'?'button':'div',name==='el-table-column'?[]:[p.title,p.label,slots.default?.()])});
 return renderToString(app);
}
test('only applicant sees withdrawal while pending',async()=>{
 const r={id:10,status:'pending',requester_id:'1'};assert.match(await render('ClosureActions.vue',r),/撤回申请/);assert.doesNotMatch(await render('ClosureActions.vue',r,2),/撤回申请/);
});
test('reopen available to owner of effective report, not viewer or voided report',async()=>{
 const r={id:10,status:'approved',isOwner:true};assert.match(await render('ClosureActions.vue',r),/申请重开纠错/);assert.doesNotMatch(await render('ClosureActions.vue',{...r,isOwner:false}),/申请重开纠错/);assert.doesNotMatch(await render('ClosureActions.vue',{...r,status:'voided'}),/申请重开纠错/);
});
test('pending reopen prevents duplicate request and only assigned reviewer sees decision buttons',async()=>{
 const r={id:10,status:'approved',isOwner:true,reopens:[{id:4,status:'pending',approver_id:'2',reason:'核实依据'}]};
 const owner=await render('ClosureActions.vue',r);assert.doesNotMatch(owner,/申请重开纠错|通过重开/);assert.match(await render('ClosureActions.vue',r,2),/通过重开/);
});
test('report clearly distinguishes invalidation, approval delay and first plan; user content escaped',async()=>{
 const data={project:{name:'<script>bad()</script>'},owners:[],tasks:[],delays:[],updates:[],assets:[],changes:[],waitingDays:0,approvalWaitingDays:3,approvalLateOnly:true,firstPlanEnd:'2026-09-10',firstPlan:{tasks:[]}};
 const html=await render('ClosureReport.vue',{status:'voided',report:data});assert.match(html,/原结项报告已失效/);assert.match(html,/申请按时，审批生效晚于计划/);assert.match(html,/2026-09-10/);assert.doesNotMatch(html,/<script>bad/);
});

test('report highlights system timing findings for HR and leadership without requesting reasons', async () => {
  const data = { project: { name: '测试项目' }, owners: [{ name: '负责人A' }], tasks: [], delays: [], updates: [], assets: [], changes: [], waitingDays: 3, approvalWaitingDays: 1,
    timingAlerts: ['全部任务验收完成后 3 天才申请结项。', '申请结项时已超过批准截止日期 2 天。'] };
  const html = await render('ClosureReport.vue', { status: 'approved', report: data });
  assert.match(html, /全部任务验收完成后 3 天才申请结项/);
  assert.match(html, /申请结项时已超过批准截止日期 2 天/);
  assert.match(html, /HR 和领导.*项目负责人/);
  assert.doesNotMatch(html, /未触发必填|延迟申请原因|超期申请原因/);
});

test('report uses the same escaped document in a script-disabled sandbox',async()=>{
 const html=await render('ClosureReport.vue',{id:1,status:'approved',reportHtml:'<!doctype html><html><body>报告内容</body></html>'});
 assert.match(html,/srcdoc=/);assert.match(html,/title="项目结项报告"/);assert.match(html,/sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"/);assert.doesNotMatch(html,/allow-scripts/);assert.match(html,/展开核查明细/);assert.match(html,/只看总结/);
});
