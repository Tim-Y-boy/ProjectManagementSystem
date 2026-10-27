const {test}=require('node:test');
const assert=require('node:assert/strict');
const {reportModel}=require('../src/modules/closures/closure-report-model');
const {renderClosureReport}=require('../src/modules/closures/closure-report');
const task=(id,parent_id,completed_at='2026-09-15T08:00:00Z')=>({id,parent_id,title:'任务'+id,status:'done',start_at:'2026-09-01',due_at:'2026-09-15',completed_at,participants:[{name:'执行人甲',role:'assignee'}]});
const update=(id,task_id,status='normal')=>({id,task_id,work_date:'2026-09-14',created_at:'2026-10-09T08:00:00Z',status,content:'进展'+id,no_material_reason:'过程性工作'});
function fixture(){return {id:7,status:'approved',requested_at:'2026-10-09T08:00:00Z',report:{project:{name:'结项测试',start_at:'2026-09-01'},owners:[],tasks:[task(1,null),task(2,1),task(3,1,'2026-10-09T08:00:00Z'),task(4,null,'2026-10-09T08:00:00Z'),{...task(5,null),status:'cancelled'}],updates:[update(1,3,'exempted'),update(2,3,'supplemented'),update(3,4,'exempted')],assets:[{id:9,task_id:3,daily_update_id:2,title:'会议记录',url:'https://example.com/doc'}],delays:[],changes:[],plannedEnd:'2026-09-15',completedAt:'2026-10-09T08:00:00Z',lateDays:24}};}
test('report counts effective leaf tasks once and separates partial exemption from fully reasonable supplement',()=>{
 const m=reportModel(fixture());assert.equal(m.total,3);assert.equal(m.counts.ontime,1);assert.equal(m.counts.late,1);assert.equal(m.counts.supplement,1);assert.equal(m.cancelled,1);
 assert.equal(m.tasks.find(t=>t.id===3).kind,'late');assert.equal(m.tasks.find(t=>t.id===4).kind,'supplement');
 assert.equal(m.groups.find(g=>g.id==='1').tasks.length,2);assert.equal(m.tasks.find(t=>t.id===3).updates[1].assets[0].id,9);
});
test('invalid completion dates and missing deadlines stay unknown; Beijing midnight changes result',()=>{
 const r=fixture();r.report.tasks=[task(1,null,'2026-09-15T16:00:00Z'),{...task(2,null),due_at:null},task(3,null,'broken')];r.report.updates=[];
 const m=reportModel(r);assert.equal(m.counts.late,1);assert.equal(m.counts.unknown,2);assert.equal(m.tasks[0].lateDays,1);
});
test('report groups orphan evidence separately and never loses cancelled-task evidence',()=>{
 const r=fixture();r.report.updates.push(update(4,5),update(5,99));r.report.assets.push({id:10,task_id:null,title:'项目方案'});
 const m=reportModel(r);assert.equal(m.otherUpdates.length,2);assert.equal(m.otherAssets.length,1);
});
test('HTML is standalone, navigable and safe, with task titles, dates, progress and material links',()=>{
 const r=fixture();r.report.project.name='<script>alert(1)</script>';r.report.assets.push({id:11,task_id:2,title:'恶意链接',url:'javascript:alert(1)'},{id:12,task_id:2,title:'交付文件',file_path:'/private/test.doc',original_name:'交付.doc'});
 const html=renderClosureReport(r);assert.match(html,/项目总览/);assert.match(html,/是否按期/);assert.match(html,/成果全貌/);assert.match(html,/进展2/);assert.match(html,/会议记录/);assert.match(html,/href="https:\/\/example.com\/doc"/);assert.match(html,/延期完成/);assert.match(html,/正常完成/);assert.match(html,/合理补填/);assert.match(html,/附件需在系统内下载/);assert.match(html,/@media print/);
 assert.doesNotMatch(html,/<script|javascript:|\/private\/test.doc|<iframe|<img|onerror=/i);assert.match(html,/&lt;script&gt;/);
 const embedded=renderClosureReport(r,{embedded:true});assert.match(embedded,/data-asset-id="12"/);
});
test('historical missing arrays and pending application render as incomplete evidence, not zero evidence',()=>{
 const html=renderClosureReport({id:1,status:'pending',snapshot:{project:{name:'申请'},tasks:[],owners:[]}});
 assert.match(html,/结项申请/);assert.match(html,/未留存|审批通过后/);assert.doesNotMatch(html,/NaN|undefined|Invalid Date/);
});

test('report prioritizes exceptions, exposes vertical jump links and collapses task detail by default',()=>{
 const r=fixture();r.report.waitingDays=0;r.report.approvalWaitingDays=0;
 const html=renderClosureReport(r);
 assert.match(html,/<nav[^>]*aria-label="报告目录"/);assert.match(html,/点击跳转/);
 assert.match(html,/class="nav-link[^\"]*"[^>]*href="#attention"/);
 assert.ok(html.indexOf('id="attention"')<html.indexOf('id="evidence"'));
 assert.doesNotMatch(html,/<details class="task"[^>]*\sopen[\s>]/);
 assert.doesNotMatch(html,/验收完成后 <b>0 天|审批等待 <b>0 天|class="numbers"/);
 assert.doesNotMatch(html,/<ol class="flow"/); assert.match(html,/日期事项/);
});
test('progress and handling histories use oldest-first records without mutating the report snapshot',()=>{
 const r=fixture();r.report.updates=[{...update(20,3),work_date:'2026-09-13',content:'后发生进展'},{...update(10,3),work_date:'2026-09-07',content:'先发生进展'}];
 r.report.delays=[{id:1,snapshot:{title:'延期事项',days:2},observed_at:'2026-09-16',history:[{id:2,created_at:'2026-09-18',comment:'后续处理'},{id:1,created_at:'2026-09-17',comment:'首次处理'}]}];
 const before=JSON.stringify(r);const html=renderClosureReport(r);
 const records=[...html.matchAll(/<article class="progress">([\s\S]*?)<\/article>/g)].map(v=>v[1]).join('');
 assert.ok(records.indexOf('先发生进展')<records.indexOf('后发生进展'));
 assert.ok(html.indexOf('首次处理')<html.indexOf('后续处理'));
 assert.equal(JSON.stringify(r),before);
});

test('timeline uses frozen completion, application and closure dates and keeps business activity separate',()=>{
 const r=fixture();
 Object.assign(r.report,{completedAt:'2026-10-01T01:00:00Z',requestedAt:'2026-10-02T02:00:00Z',closedAt:'2026-10-03T03:00:00Z',lastActivityAt:'2026-09-30T04:00:00Z',reportNumber:'JX-7',version:2,requester:{name:'申请人甲'},approver:{name:'审批人乙'}});
 const html=renderClosureReport(r);
 assert.match(html,/批准截止<\/td><td><strong class="key-date">2026-09-15/);
 assert.match(html,/任务全部验收<\/td><td><strong class="key-date">2026\/10\/1 09:00/);
 assert.match(html,/申请结项<\/td><td><strong class="key-date">2026\/10\/2 10:00/);
 assert.match(html,/结项生效<\/td><td><strong class="key-date">2026\/10\/3 11:00/);
 assert.match(html,/最后业务操作<\/dt><dd>2026\/9\/30 12:00/);
 assert.match(html,/申请人甲/);assert.match(html,/审批人乙/);
});
test('plan change comparison reads stored before and after fields and preserves supplement notice text',()=>{
 const r=fixture();r.report.changes=[{id:1,status:'approved',created_at:'2026-09-02',reason:'调整排期',items:[{task_id:3,change_type:'date',before:{startAt:'2026-09-01',dueAt:'2026-09-10'},after:{startAt:'2026-09-01',dueAt:'2026-09-15'}}]}];
 r.report.supplementNotices=[{id:1,created_at:'2026-10-09',payload:{title:'合理补填告知',text:'已核实历史补录'}}];
 const html=renderClosureReport(r);
 assert.match(html,/<th scope="col">调整前<\/th>/); assert.match(html,/<td>2026-09-01 至 2026-09-10<\/td><td>2026-09-01 至 2026-09-15<\/td>/);
 assert.match(html,/<th scope="col">调整后<\/th>/);
 assert.match(html,/已核实历史补录/);
});

test('fully reasonable supplement highlights the confirmed reason without a red task delay warning',()=>{
 const r=fixture();
 r.report.tasks=[{...task(4,null,'2026-10-08T07:23:00Z'),start_at:'2026-08-25',due_at:'2026-08-26'}];
 r.report.updates=[{...update(3,4,'exempted'),work_date:'2026-08-25',exempt_reason:'历史项目补录',created_at:'2026-10-08T07:05:00Z'}];
 r.report.lateDays=43;r.report.delays=[{id:1,task_id:4,observed_at:'2026-10-08',snapshot:{title:'任务4',days:43}}];
 const before=JSON.stringify(r);
 for(const embedded of [false,true]){
   const html=renderClosureReport(r,{embedded});
   const detail=html.slice(html.indexOf('<details class="task"'),html.indexOf('</details>',html.indexOf('<details class="task"'))+10);
   assert.match(detail,/已确认合理补填/);assert.match(detail,/历史项目补录/);
   assert.match(detail,/系统验收记录晚于截止 43 天/);
   assert.doesNotMatch(detail,/class="delay-number"/);
   assert.doesNotMatch(html,/<p class="verdict is-late"/);
   assert.match(html,/1 项已确认合理补填/);
   assert.doesNotMatch(html,/延期合理补填/);
   assert.doesNotMatch(html,/<strong class="delay-number">43 天/);
 }
 assert.equal(JSON.stringify(r),before);
});
test('partial reasonable supplement still shows the task delay and explains that the exemption is partial',()=>{
 const html=renderClosureReport(fixture());
 const start=html.indexOf('<details class="task" id="task-3"');
 const detail=html.slice(start,html.indexOf('</details>',start)+10);
 assert.match(detail,/class="delay-number"/);
 assert.match(detail,/部分进展已确认合理补填/);
 assert.match(detail,/延期完成/);
});

test('last progress work date is separate from the last submission time, including backfills',()=>{
 const r=fixture();
 r.report.updates=[
 {...update(1,3),work_date:'2026-09-14',created_at:'2026-10-08T08:00:00Z',content:'完成联调'},
 {...update(2,3),work_date:'2026-09-07',created_at:'2026-10-09T08:00:00Z',content:'补录前期评审'},
 {...update(3,3),work_date:'broken',created_at:'broken'}
 ];
 const before=JSON.stringify(r), t=reportModel(r).tasks.find(t=>t.id===3);
 assert.equal(t.latestWorkDate,'2026-09-14');
 assert.equal(t.lastSubmittedAt,'2026-10-09T08:00:00Z');
 const html=renderClosureReport(r);
 assert.match(html,/最后进展工作日期：<\/span><strong class="key-date">2026-09-14/);
 assert.match(html,/最后填报时间：<\/span><strong class="key-date">2026\/10\/9 16:00/);
 assert.equal(JSON.stringify(r),before);
});
test('each work record keeps its own linked materials beside its content and distinguishes the closure workflow',()=>{
 const html=renderClosureReport(fixture());
 const records=[...html.matchAll(/<article class="progress">([\s\S]*?)<\/article>/g)].map(m=>m[1]);
 const matching=records.find(v=>v.includes('进展2'));
 assert.match(matching,/会议记录/);
 assert.ok(matching.indexOf('progress-head')<matching.indexOf('工作内容'));
 assert.doesNotMatch(records.find(v=>v.includes('进展1')),/会议记录/);
 assert.match(html,/项目计划与结项记录/);
 assert.match(html,/<th scope="col">日期事项<\/th>/);
 assert.doesNotMatch(html,/<h3>实际执行<\/h3>|>时间进程</);
});

test('management report removes duplicate reasons and flow decoration while retaining dated evidence',()=>{
 const r=fixture();r.report.tasks=[task(4,null,'2026-10-09T08:00:00Z')];
 r.report.updates=[{...update(3,4,'exempted'),exempt_reason:'历史项目补录',no_material_reason:'现场沟通无文件'}];
 r.report.tasks[0].material_exemption_reason='现场沟通无文件';
 const html=renderClosureReport(r);
 const start=html.indexOf('<details class="task"'), detail=html.slice(start,html.indexOf('</details>',start)+10);
 assert.equal((detail.match(/历史项目补录/g)||[]).length,1);
 assert.equal((detail.match(/现场沟通无文件/g)||[]).length,1);
 assert.doesNotMatch(html,/supplement-conclusion|acceptance-material-note|class="flow"|content:'↓'/);
 assert.match(html,/项目总结报告/);
 assert.match(html,/class="key-date"/);
});
test('task hierarchy preserves three levels and orphan tasks without mutation',()=>{
 const {reportHierarchy}=require('../src/modules/closures/closure-report-model');
 const tasks=[{id:12,parent_id:11,title:'三级任务'},{id:1,parent_id:null,title:'主任务'},{id:11,parent_id:1,title:'二级任务'},{id:99,parent_id:88,title:'历史独立任务'}];
 const before=JSON.stringify(tasks), rows=reportHierarchy(tasks);
 assert.deepEqual(rows.map(r=>[r.task.id,r.depth]),[[1,0],[11,1],[12,2],[99,0]]);
 assert.equal(JSON.stringify(tasks),before);
 assert.equal(reportHierarchy([{id:1,parent_id:2},{id:2,parent_id:1}]).length,2);
 const r=fixture();r.report.firstPlan={tasks};const html=renderClosureReport(r);
 assert.match(html,/主任务/);assert.match(html,/子任务/);assert.match(html,/三级任务/);
});
test('historical delay snapshots explain observation dates and group repeated records by subject',()=>{
 const r=fixture();r.report.delays=[
 {id:1,task_id:3,kind:'task_overdue',observed_at:'2026-10-08',snapshot:{title:'任务3',dueAt:'2026-09-15',days:23}},
 {id:2,task_id:3,kind:'task_overdue',observed_at:'2026-10-09',snapshot:{title:'任务3',dueAt:'2026-09-15',days:24}}
 ];
 const html=renderClosureReport(r);
 assert.match(html,/记录日期/);assert.match(html,/截至当天已超期/);assert.match(html,/不能相加/);
 assert.doesNotMatch(html,/当次记录 <strong/);
});

test('executive summary answers completion, schedule, outputs and exceptions before audit details',()=>{
 const r=fixture();const html=renderClosureReport(r);
 const brief=html.slice(html.indexOf('<section class="executive-brief"'),html.indexOf('<section class="section" id="results"'));
 for(const text of ['全部任务已完成','是否按期','任务完成情况','延期完成','延期与关注']) assert.ok(brief.includes(text),text);
 assert.doesNotMatch(brief,/延期历史采集|当时记录天数|项目级时间记录|合理补填告知/);
 assert.match(html,/<section class="section" id="results">[\s\S]*deliverable-list/); assert.match(html,/任务成果摘要/);
 assert.ok(html.indexOf('id="results"')<html.indexOf('id="evidence"'));
 assert.match(html,/<details class="archive-details"><summary><strong>全部任务进展与资料/);
});
test('summary preserves completion uncertainty and does not equate historical backfill with ordinary delay',()=>{
 const {executiveReport}=require('../src/modules/closures/closure-report-summary');
 const r=fixture();r.report.tasks=[task(4,null,'2026-10-09T08:00:00Z')];r.report.updates=[update(3,4,'exempted')];
 let brief=executiveReport(reportModel(r));assert.equal(brief.schedule,'历史补录已确认');assert.equal(brief.tone,'supplement');
 r.report.tasks[0].completed_at='broken';brief=executiveReport(reportModel(r));assert.equal(brief.schedule,'部分完成时间待核实');
 r.report.tasks[0].status='doing';brief=executiveReport(reportModel(r));assert.equal(brief.completed,0);assert.equal(brief.schedule,'仍有任务未完成');
});
test('summary quotes recorded results and deduplicates issues without inventing outcomes',()=>{
 const {executiveReport,reportExcerpt}=require('../src/modules/closures/closure-report-summary');
 const r=fixture();r.report.updates=[
 {...update(1,3),work_date:'2026-09-07',content:'完成方案评审',risk:'供应商交付时间待确认'},
 {...update(2,3),work_date:'2026-09-14',content:'完成联调',risk:'供应商交付时间待确认'},
 {...update(3,3),work_date:'broken',content:'不得作为最新工作结果'}
 ];
 r.report.changes=[{status:'approved',created_at:'2026-09-10',reason:'测试窗口调整'},{status:'rejected',created_at:'2026-09-12',reason:'未通过的变更'}];
 const before=JSON.stringify(r),brief=executiveReport(reportModel(r));
 assert.equal(brief.results.flatMap(g=>g.tasks).find(t=>t.id===3).latest.content,'完成联调');
 assert.equal(brief.points.length,2);assert.equal(brief.points[0].date,'2026-09-14');
 assert.equal(JSON.stringify(r),before);assert.equal(reportExcerpt('  这是  很长的内容 ',5),'这是 很长…');
});

test('project schedule distinguishes final deadline from intermediate task delays',()=>{
 const {executiveReport}=require('../src/modules/closures/closure-report-summary');
 const r=fixture();r.report.plannedEnd='2026-10-10';
 assert.equal(executiveReport(reportModel(r)).schedule,'项目按期完成，部分任务曾延期');
 r.report.plannedEnd='2026-09-15';
 assert.equal(executiveReport(reportModel(r)).schedule,'项目验收晚于计划 24 天');
 r.report.assets.push({id:15,task_id:5,title:'已取消任务的历史资料'});
 const brief=executiveReport(reportModel(r));assert.equal(brief.outcomeAssets.some(a=>a.id===15),false);
 assert.match(renderClosureReport(r),/已取消任务的历史资料/);
});

test('charts retain status counts, completion percentage and accessible names',()=>{
 const {completionChart,delayChart}=require('../src/modules/closures/closure-report-charts');
 const {executiveReport}=require('../src/modules/closures/closure-report-summary');
 const m=reportModel(fixture()),chart=completionChart(m,executiveReport(m));
 assert.match(chart,/role="img" aria-label="已完成 3 项，共 3 项，完成率 100%"/);
 for(const label of ['正常完成','延期完成','已确认合理补填'])assert.match(chart,new RegExp(label));
 const delay=delayChart(m,(_id,title)=>title);
 assert.match(delay,/24 天/);assert.match(delay,/#task-3/);assert.doesNotMatch(delay,/#task-4/);
 const empty=reportModel({report:{tasks:[],updates:[],assets:[]}});
 const emptyChart=completionChart(empty,executiveReport(empty));
 assert.match(emptyChart,/暂无任务数据/);assert.doesNotMatch(emptyChart,/NaN|Infinity|100%/);
});
test('deliverables keep nested task attribution without material-count bars',()=>{
 const r=fixture();r.report.tasks.push({...task(6,2),title:'三级任务'});
 r.report.assets=[{id:1,task_id:1,title:'主任务资料'},{id:2,task_id:2,title:'子任务资料'},{id:3,task_id:6,title:'三级资料'},{id:4,task_id:null,title:'公共资料'},{id:5,task_id:5,title:'已取消任务资料'}];
 const html=renderClosureReport(r),start=html.indexOf('<ul class="deliverable-list">'),end=html.indexOf('<details class="archive-details">',start);
 const list=html.slice(start,end);
 assert.match(list,/任务1 \/ 任务2 \/ 三级任务/);assert.match(list,/公共资料/);
 assert.doesNotMatch(list,/已取消任务资料|bar-track|outcome-fill/);assert.match(html,/已取消任务资料/);
});
test('chart labels are escaped and large outputs keep a bounded overview',()=>{
 const {delayChart}=require('../src/modules/closures/closure-report-charts');
 const {executiveReport}=require('../src/modules/closures/closure-report-summary');
 const r=fixture();r.report.tasks=Array.from({length:8},(_,i)=>({...task(i+10,null,'2026-10-09T08:00:00Z'),title:i===0?'<img src=x onerror=alert(1)>':'任务'+i}));
 r.report.assets=r.report.tasks.map(t=>({id:t.id,task_id:t.id}));
 const m=reportModel(r),html=renderClosureReport(r)+delayChart(m,(_id,title)=>title);
 assert.match(html,/查看全部资料/);assert.match(html,/前 5 项/);assert.doesNotMatch(html,/outcome-fill|交付成果分布/);
 assert.doesNotMatch(html,/<img|<script|NaN|Infinity/);
 assert.match(html,/&lt;img/);
});
test('overview reports all-late completion honestly and scans as numbers rather than prose',()=>{
 const {executiveReport}=require('../src/modules/closures/closure-report-summary');
 const r=fixture();r.report.tasks=r.report.tasks.map(t=>t.id===2?{...t,completed_at:'2026-10-09T08:00:00Z'}:t);
 assert.equal(executiveReport(reportModel(r)).completion,'全部 3 项已完成，均晚于计划');
 const html=renderClosureReport(r);
 const band=html.slice(html.indexOf('<div class="stat-band">'),html.indexOf('<div class="overview-charts">'));
 assert.match(band,/按期完成<\/span><strong class="stat-value">0 项/);assert.match(band,/无一项按期/);
 assert.match(band,/延期完成<\/span><strong class="stat-value">2 项/);assert.match(band,/最长 24 天/);
});
test('pending supplement acknowledgements surface as a first-screen number instead of staying in evidence',()=>{
 const notice={id:1,created_at:'2026-10-09T08:00:00Z',recipient_name:'领导',payload:{supplement:{taskTitle:'任务4',workDate:'2026-09-14',reason:'历史补录'}}};
 const r=fixture();r.report.supplementNotices=[notice];
 const html=renderClosureReport(r);
 const band=html.slice(html.indexOf('<div class="stat-band">'),html.indexOf('<div class="overview-charts">'));
 assert.match(band,/补填待知晓<\/span><strong class="stat-value">1 条/);assert.match(band,/需领导确认/);
 assert.doesNotMatch(html,/NaN|undefined/);
 const known=fixture();known.report.supplementNotices=[{...notice,acknowledged_at:'2026-10-09T09:00:00Z'}];
 assert.doesNotMatch(renderClosureReport(known),/补填待知晓/);
});

test('shared evidence appears under every associated progress but counts as one deliverable',()=>{
 const r=fixture(); r.report.assets[0].linked_daily_update_ids=[1,2];
 const m=reportModel(r), t=m.tasks.find(t=>t.id===3);
 assert.equal(m.assets.length,1); assert.equal(t.assets.length,1);
 assert.deepEqual(t.updates.map(u=>u.assets.map(a=>a.id)),[[9],[9]]);
 const html=renderClosureReport(r);
 const articles=[...html.matchAll(/<article class="progress">([\s\S]*?)<\/article>/g)].map(match=>match[1]);
 assert.equal(articles.filter(article=>article.includes('会议记录')).length,2);
});
