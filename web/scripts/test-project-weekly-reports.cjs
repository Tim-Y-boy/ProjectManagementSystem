const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const ts = require('typescript');
const vue = require('vue');
const { parse } = require('@vue/compiler-sfc');
const read = p => fs.readFileSync(path.join(__dirname, '../src', p), 'utf8');
const utilContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('utils/project-weekly-report.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, utilContext);
const helpers = utilContext.exports;
test('work reports routes and navigation stay accessible without daily-report permission', async () => {
 const auth = { isLoggedIn: true, user: { id: 1 }, readOnly: false, has: () => false };
 let routes, guard;
 const context = {
  exports: {}, useAuthStore: () => auth,
  useDailyReportStore: () => ({ allowed: false, refresh: async () => {} }),
  createWebHistory: () => ({}),
  createRouter: config => { routes = config.routes; return { beforeEach: fn => { guard = fn; } }; },
 };
 const source = read('router/index.ts').replace(/^import .*;\r?$/gm, '');
 vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText, context);
 for (const parent of routes.filter(item => item.children)) {
  const route = parent.children.find(item => item.path === 'daily-report');
  assert.equal(route.meta.title, '周报/日报');
  assert.equal(route.meta.dailyReport, undefined);
  assert.equal(await guard({ ...route, path: parent.path === '/mobile' ? '/mobile/daily-report' : '/daily-report', query: { tab: 'weekly' } }), true);
 }
 assert.match(read('components/NavMenu.vue'), /name: 'daily-report', label: '周报\/日报'/);
 assert.match(read('views/mobile/MobileMine.vue'), /查看周报\/日报/);
 assert.match(read('views/WorkReports.vue'), /v-if="tab === 'daily' && report.allowed"/);
});
function component(file, names, deps) {
 const script = parse(read(file)).descriptor.scriptSetup.content.replace(/^import .*;\r?$/gm, '');
 const context = { ...vue, ...helpers, setTimeout, clearTimeout, onMounted:()=>{}, onUnmounted:()=>{}, useWeeklyReportUnreadStore: () => ({markSeen:()=>{},refresh:async()=>{}}), ...deps };
 vm.runInNewContext(ts.transpileModule(script + `\nglobalThis.page = { ${names} };`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText, context);
 return context.page;
}
test('week normalization handles month/year boundaries and reports prioritize risks', () => {
 assert.equal(helpers.weeklyMonday('2027-01-03'), '2026-12-28');
 assert.equal(helpers.weeklyMonday('2026-11-01'), '2026-10-26');
 assert.equal(helpers.weeklyMonday('invalid'), '');
 assert.equal(helpers.weeklyPriority({overallStatus:'blocked'}),0);
 assert.equal(helpers.weeklyPriority({overallStatus:'risk'}),1);
 assert.equal(helpers.weeklyPriority({overallStatus:'normal',coordination:'Need support'}),2);
 assert.equal(helpers.weeklyPriority({overallStatus:'normal'}),3);
});
test('previous-week deep link loads exact detail and project history requests all weeks', async () => {
 const calls=[]; let watcher;
 const route=vue.reactive({query:{projectId:'42',weekStart:'2026-10-26'},path:'/daily-report'});
 const page=component('views/ProjectWeeklyReports.vue','load, detail, week', {
  useRoute:()=>route,useRouter:()=>({}),useAuthStore:()=>({has:()=>false}),watch:fn=>{watcher=fn},
  projectWeeklyReportsApi:{detail:async(...args)=>{calls.push(args);return {projectId:42}},list:async args=>{calls.push(args);return []}},
 });
 await page.load(); assert.equal(page.week.value,'2026-10-26'); assert.deepEqual(calls[0],[42,'2026-10-26']);
 route.query={projectId:'42',history:'1'}; await page.load();
 assert.equal(calls[1].allWeeks,true); assert.equal(calls[1].projectId,42); assert.equal(calls[1].weekStart,undefined);
});

test('editable weekly reports are separated ahead of view-only reports, including saved reports', () => {
 const auth=vue.reactive({has:()=>false,readOnly:false});
 const page=component('views/ProjectWeeklyReports.vue','rows, reportSections, status', {
  useRoute:()=>({query:{},path:'/daily-report'}),useRouter:()=>({}),useAuthStore:()=>auth,watch:()=>{},
 });
 page.rows.value=[
  {projectId:4,canEdit:false,status:'missing'},
  {projectId:5,canEdit:true,status:'missing'},
  {projectId:6,canEdit:true,status:'submitted'},
  {projectId:7,canEdit:false,status:'submitted'},
 ];
 assert.equal(page.reportSections.value[0].key,'write');
 assert.equal(page.reportSections.value[0].rows.map(r=>r.projectId).join(','),'5,6');
 assert.equal(page.reportSections.value[1].rows.map(r=>r.projectId).join(','),'4,7');
 page.status.value='submitted';
 assert.equal(page.reportSections.value[0].rows.length,1);
 auth.readOnly=true;
 assert.equal(page.reportSections.value.length,1);
 assert.equal(page.reportSections.value[0].key,'view');
 assert.equal(page.reportSections.value[0].rows.length,2);
});
test('saved reports remain editable; save conflicts preserve input; readonly cannot save', async () => {
 const detail=vue.reactive({projectId:42,weekStart:'2026-10-26',version:2,status:'submitted',canEdit:true,overallStatus:'normal',achievements:'partial work',risks:'',coordination:'',nextWeek:''});
 const auth=vue.reactive({readOnly:false}); const calls=[]; let changed=0; let fail=false;
 const page=component('components/weekly/WeeklyReportEditor.vue','save, form, editable, error', {
  defineProps:()=>({detail}), defineEmits:()=>()=>{},defineExpose:()=>{},
  onBeforeRouteLeave:()=>{},onBeforeRouteUpdate:()=>{},useAuthStore:()=>auth,useRefreshStore:()=>({markProjectChanged:()=>changed++}),
  ElMessage:{success:()=>{}}, ElMessageBox:{confirm:async()=>{}},
  projectWeeklyReportsApi:{save:async body=>{calls.push(body);if(fail)throw new Error('conflict');return detail}},
 });
 assert.equal(page.editable.value,true);
 page.form.value.achievements='Changed'; await page.save(); assert.equal(changed,1); assert.equal(calls[0].version,2);
 page.form.value.achievements='unfinished notes'; fail=true; await page.save();
 assert.equal(page.error.value,'conflict'); assert.equal(page.form.value.achievements,'unfinished notes');
 auth.readOnly=true; await page.save(); assert.equal(calls.length,2);
 auth.readOnly=false; detail.canEdit=false; assert.equal(page.editable.value,false);
 await page.save(); assert.equal(calls.length,2);
 const template=parse(read('components/weekly/WeeklyReportEditor.vue')).descriptor.template.content;
 assert.doesNotMatch(template,/正式提交|保存草稿|修订|历史版本/);
});

test('weekly evidence groups by task identity, sorts newest first and preserves history', () => {
 const evidence={updates:[
  {id:1,taskId:7,taskTitle:'Same title',workDate:'2026-11-02',risk:'Earlier risk'},
  {id:2,taskId:7,taskTitle:'Same title',workDate:'2026-11-04'},
  {id:3,taskId:8,taskTitle:'Same title',workDate:'2026-11-03'},
 ],assets:[],tasks:[]};
 const page=component('components/weekly/WeeklyEvidence.vue','groups',{
  defineProps:()=>({evidence}),watch:()=>{},formatBeijingTime:value=>value,
 });
 assert.equal(page.groups.value.length,2);
 assert.equal(page.groups.value[0].items[0].id,2);
 assert.equal(page.groups.value[0].items[1].risk,'Earlier risk');
 assert.equal(evidence.updates[0].id,1);
 assert.equal(page.groups.value[1].items[0].taskId,8);
});
test('active tasks without current updates retain history access without duplicating updated tasks', async () => {
 const evidence={updates:[{id:10,taskId:7,workDate:'2026-11-04'}],assets:[],tasks:[],activeTasks:[
  {id:7,taskId:7},{id:8,taskId:8,taskTitle:'Still running',hasHistory:true,sourcePath:'/tasks?taskId=8'}]};
 const page=component('components/weekly/WeeklyEvidence.vue','groups,history,loadHistory',{
  defineProps:()=>({evidence,weekStart:'2026-11-02',weekEnd:'2026-11-08'}),watch:()=>{},formatBeijingTime:value=>value,
  tasksApi:{dailyUpdates:async id=>{assert.equal(id,8);return [{id:20,workDate:'2026-10-29',content:'Earlier progress'}];}},
 });
 assert.equal(page.groups.value.length,2);
 const missing=page.groups.value[1];
 assert.equal(missing.items.length,0);
 assert.equal(missing.task.taskTitle,'Still running');
 await page.loadHistory(missing);
 assert.equal(page.history[missing.key].items[0].content,'Earlier progress');
 assert.equal(page.history[missing.key].items[0].sourcePath,'/tasks?taskId=8');
});
test('other-week progress loads lazily, excludes selected week and retries failures', async () => {
 const current={id:2,taskId:7,workDate:'2026-11-04',sourcePath:'/tasks?taskId=7'};
 let calls=0;
 const page=component('components/weekly/WeeklyEvidence.vue','groups, history, loadHistory',{
  defineProps:()=>({evidence:{updates:[current],assets:[],tasks:[]},weekStart:'2026-11-02',weekEnd:'2026-11-08'}),
  watch:()=>{},formatBeijingTime:value=>value,
  tasksApi:{dailyUpdates:async()=>{ calls++; if(calls===1) throw Error('offline'); return [current,{id:3,workDate:'2026-11-03'},{id:1,workDate:'2026-10-26',content:'Earlier week'}]; }},
 });
 assert.equal(calls,0);
 const group=page.groups.value[0];
 await page.loadHistory(group);
 assert.ok(page.history[group.key].error);
 await page.loadHistory(group);
 assert.equal(page.history[group.key].items.length,1);
 assert.equal(page.history[group.key].items[0].content,'Earlier week');
 assert.equal(page.history[group.key].items[0].sourcePath,current.sourcePath);
 await page.loadHistory(group);
 assert.equal(calls,2);
});
test('autosave refresh preserves expanded history including in-flight requests', async () => {
 const props=vue.reactive({projectId:5,weekStart:'2026-11-02',weekEnd:'2026-11-08',evidence:{updates:[{id:2,taskId:7,workDate:'2026-11-04'}],assets:[],tasks:[]}});
 let resolve;
 const page=component('components/weekly/WeeklyEvidence.vue','groups,history,loadHistory',{
  defineProps:()=>props,formatBeijingTime:value=>value,tasksApi:{dailyUpdates:()=>new Promise(r=>{resolve=r})},
 });
 const pending=page.loadHistory(page.groups.value[0]);
 props.evidence={...props.evidence}; await vue.nextTick();
 resolve([{id:1,workDate:'2026-10-26',content:'History'}]); await pending;
 assert.equal(page.history['task:7'].items[0].content,'History');
 props.evidence={...props.evidence}; await vue.nextTick();
 assert.equal(page.history['task:7'].loaded,true);
 props.weekStart='2026-11-09'; await vue.nextTick();
 assert.equal(page.history['task:7'],undefined);
});

test('draft autosave accepts partial input; submission validates, confirms and locks', async () => {
 const props=vue.reactive({detail:{projectId:5,weekStart:'2026-11-02',version:0,status:'missing',canEdit:true,overallStatus:'normal'}});
 const calls=[]; let confirmed=0; let allow=false;
 const page=component('components/weekly/WeeklyReportEditor.vue','save, submitReport, form, dirty, statusError, editable, canLeave',{
  defineProps:()=>props,defineEmits:()=>(_,value)=>{props.detail=value},defineExpose:()=>{},
  onBeforeRouteLeave:()=>{},onBeforeRouteUpdate:()=>{},
  useAuthStore:()=>({readOnly:false}),useRefreshStore:()=>({markProjectChanged:()=>{}}),
  ElMessage:{success:()=>{}},ElMessageBox:{confirm:async()=>{confirmed++;if(!allow)throw Error('cancel')}},
  projectWeeklyReportsApi:{
   save:async body=>{calls.push(['save',body]);return {...props.detail,...body,version:body.version+1,status:'draft',canEdit:true}},
   submit:async body=>{calls.push(['submit',body]);return {...props.detail,...body,version:body.version+1,status:'submitted',canEdit:false}},
  },
 });
 assert.equal(page.form.value.overallStatus,''); assert.equal(page.dirty.value,false);
 page.form.value.achievements='Partial';
 await page.save(); await vue.nextTick();
 assert.equal(calls[0][1].overallStatus,''); assert.equal(page.dirty.value,false);
 await page.submitReport(); assert.ok(page.statusError.value); assert.equal(confirmed,0);
 page.form.value.overallStatus='risk'; page.form.value.nextWeek='Next';
 await page.submitReport(); assert.equal(confirmed,1); assert.equal(calls.filter(x=>x[0]==='submit').length,0);
 allow=true; await page.submitReport(); await vue.nextTick();
 assert.equal(calls.filter(x=>x[0]==='submit').length,1); assert.equal(page.editable.value,false);
 await page.submitReport(); assert.equal(confirmed,2);
});

test('typing during autosave is retained; navigation flushes latest input and blocks on failure', async () => {
 const props=vue.reactive({detail:{projectId:5,weekStart:'2026-11-02',version:0,status:'missing',canEdit:true}});
 let resolve; let fail=false; const calls=[];
 const page=component('components/weekly/WeeklyReportEditor.vue','save, form, dirty, canLeave, error',{
  defineProps:()=>props,defineEmits:()=>(_,value)=>{props.detail=value},defineExpose:()=>{},
  onBeforeRouteLeave:()=>{},onBeforeRouteUpdate:()=>{},useAuthStore:()=>({readOnly:false}),useRefreshStore:()=>({markProjectChanged:()=>{}}),
  ElMessage:{success:()=>{}},ElMessageBox:{confirm:async()=>{}},
  projectWeeklyReportsApi:{save:async body=>{calls.push(body);if(fail)throw Error('offline');if(calls.length===1)await new Promise(r=>resolve=r);return {...props.detail,...body,status:'draft',version:body.version+1}}},
 });
 page.form.value.achievements='First'; const saving=page.save();
 page.form.value.achievements='Still typing'; resolve(); await saving; await vue.nextTick();
 assert.equal(page.form.value.achievements,'Still typing'); assert.equal(page.dirty.value,true);
 assert.equal(await page.canLeave(),true); assert.equal(calls[1].achievements,'Still typing'); assert.equal(calls[1].version,1);
 fail=true; page.form.value.achievements='Keep me'; assert.equal(await page.canLeave(),false);
 assert.equal(page.form.value.achievements,'Keep me'); assert.equal(page.error.value,'offline');
});


test('amendments autosave separately and approval applies content without unlocking', async () => {
 const official={overallStatus:'normal',achievements:'Original',risks:'',coordination:'',nextWeek:'Next'};
 const props=vue.reactive({detail:{...official,projectId:5,weekStart:'2026-11-02',version:4,status:'submitted',canEdit:false,canRequestAmendment:true}});
 let requests=0,reviews=0,confirm=false;
 const page=component('components/weekly/WeeklyReportEditor.vue','startAmendment,save,submitReport,requestAmendment,reviewAmendment,amendmentReason,editable,form,amendmentDialog,viewOfficial',{
  defineProps:()=>props,defineEmits:()=>(_,value)=>{props.detail=value},defineExpose:()=>{},onBeforeRouteLeave:()=>{},onBeforeRouteUpdate:()=>{},
  useAuthStore:()=>({readOnly:false}),useRefreshStore:()=>({markProjectChanged:()=>{}}),
  ElMessage:{success:()=>{},warning:()=>{},error:()=>{}},ElMessageBox:{confirm:async()=>{if(!confirm)throw Error('cancel')}},
  projectWeeklyReportsApi:{
   save:async()=>{throw Error('must not edit official report')},
   saveAmendmentDraft:async body=>({...props.detail,amendment:{id:1,status:'draft',draftVersion:body.draftVersion+1,proposedContent:{...body},originalContent:official}}),
   requestAmendment:async body=>{requests++;assert.equal(body.achievements,'Changed');assert.equal(body.draftVersion,1);return {...props.detail,canRequestAmendment:false,amendment:{...props.detail.amendment,status:'pending'}}},
   reviewAmendment:async()=>{reviews++;return {...props.detail,achievements:'Changed',version:5,status:'submitted',canEdit:false,amendment:{...props.detail.amendment,status:'approved'}}},
  },
 });
 page.startAmendment();assert.equal(page.editable.value,true);
 page.form.value.achievements='Changed';await page.save();await vue.nextTick();
 assert.equal(props.detail.achievements,'Original');assert.equal(page.form.value.achievements,'Changed');
 await page.viewOfficial();assert.equal(page.form.value.achievements,'Original');
 page.startAmendment();assert.equal(page.form.value.achievements,'Changed');
 await page.submitReport();assert.equal(page.amendmentDialog.value,true);assert.equal(requests,0);
 page.amendmentReason.value='Correction';await page.requestAmendment();await vue.nextTick();
 assert.equal(requests,1);assert.equal(page.editable.value,false);assert.equal(props.detail.achievements,'Original');
 await page.reviewAmendment(true);assert.equal(reviews,0);
 confirm=true;await page.reviewAmendment(true);await vue.nextTick();assert.equal(reviews,1);assert.equal(page.editable.value,false);assert.equal(props.detail.achievements,'Changed');
});

test('comparison shows only changed fields and preserves deletion as an explicit change',()=>{
 const page=component('components/weekly/WeeklyChangeComparison.vue','changes,text',{
  defineProps:()=>({original:{overallStatus:'normal',achievements:'Original',risks:'Old risk'},proposed:{overallStatus:'risk',achievements:'Original',risks:''}}),
 });
 assert.equal(page.changes.value.length,2);assert.equal(page.changes.value[0].key,'overallStatus');assert.equal(page.changes.value[1].key,'risks');
 assert.equal(page.text('overallStatus','risk'),'存在风险');assert.equal(page.text('risks',''),'未填写');
});
