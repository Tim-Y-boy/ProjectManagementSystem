import { assetLinksProgress } from '../tasks/task-asset-links';

import { reportModel, reportHierarchy } from './closure-report-model';
import { executiveReport, reportExcerpt } from './closure-report-summary';
import { completionChart, delayChart } from './closure-report-charts';
import { reportStyle } from './closure-report-style';
import { renderClosureReportV2 } from './closure-report-v2';

export const escapeHtml = (v: unknown) => String(v ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml;
const time=(v:any)=>v&&Number.isFinite(new Date(v).getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short',hour12:false}).format(new Date(v)):'—';
const safeUrl=(v:any)=>{try{const u=new URL(v);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}};
const table=(heads:string[],rows:string[][])=>rows.length?'<div class="table-wrap"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+e(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="empty">未留存相关记录。</p>';
const badge=(label:string,kind='')=>'<span class="tag '+kind+'">'+e(label)+'</span>';
const names=(t:any,role:string)=>(t.participants||[]).filter((p:any)=>p.role===role).map((p:any)=>p.name).join('、')||'未留存';
const assetTitle=(a:any)=>{const title=a.original_name||a.title;return !title||/^https?:\/\//i.test(title)||/^[a-z0-9-]+\.feishu\.cn$/i.test(title)?'链接资料':title;};
const ordered=(rows:any[],key:string)=>[...rows].sort((a,b)=>{
  const stamp=(v:any)=>{const n=Date.parse(v);return Number.isFinite(n)?n:Number.MAX_SAFE_INTEGER;};
  return stamp(a[key])-stamp(b[key])||Number(a.id||0)-Number(b.id||0);
});
const toggleHint='<span class="detail-hint"><span class="when-closed">展开</span><span class="when-open">收起</span><svg class="disclosure-triangle" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4h8L6 9z" fill="currentColor" /></svg></span>';
const disclosure=(title:string,body:string)=>'<details class="archive-details"><summary><strong>'+e(title)+'</strong>'+toggleHint+'</summary><div class="archive-body">'+body+'</div></details>';
const section=(id:string,title:string,body:string,intro='')=>'<section class="section" id="'+id+'"><header class="section-heading"><h2>'+e(title)+'</h2>'+(intro?'<p>'+e(intro)+'</p>':'')+'</header>'+body+'</section>';
const dateFact=(label:string,value:any,note='')=>'<span class="date-fact"><span>'+e(label)+'：</span><strong class="key-date">'+e(value)+'</strong>'+(note?'<span class="date-note">'+note+'</span>':'')+'</span>';

// 在线和独立 HTML 共用管理报告；只读快照，正文转义，无脚本或外部样式依赖。
export function renderClosureReport(r:any,options:{embedded?:boolean}={}) {
  if ([2,3].includes((r.report || r.snapshot)?.workflow?.version)) return renderClosureReportV2(r,options);
  const m=reportModel(r),d=m.data;
  const allTasks=d.tasks||[];
  const tasksById=new Map<string,any>(allTasks.map((t:any)=>[String(t.id),t]));
  const leafById=new Map<string,any>(m.tasks.map((t:any)=>[String(t.id),t]));
  const pathFor=(id:any,fallback:string)=>{
    let task=tasksById.get(String(id));const parts:string[]=[],seen=new Set<string>();
    while(task&&!seen.has(String(task.id))){seen.add(String(task.id));parts.unshift(task.title||'未命名任务');task=tasksById.get(String(task.parent_id));}
    return parts.length?parts.join(' / '):fallback;
  };
  const status:Record<string,string>={approved:'已结项',pending:'待总经办审批',rejected:'已退回',withdrawn:'已撤回',voided:'报告已失效'};
  const state=Object.prototype.hasOwnProperty.call(status,r.status)?r.status:'pending';
  const evidenceNote=m.hasEvidence?'':'审批通过后生成完整进展与资料快照；历史未留存内容不按零条计算。';
  const asset=(a:any)=>{
    const title=e(assetTitle(a)),url=safeUrl(a.url);
    const name=a.file_path?(options.embedded?'<button type="button" class="file-link" data-asset-id="'+e(a.id)+'">'+title+'</button>':'<strong>'+title+'</strong><small>附件需在系统内下载</small>'):url?'<a href="'+e(url)+'" target="_blank" rel="noopener noreferrer">'+title+'</a>':'<strong>'+title+'</strong>';
    return '<li>'+name+'<small>'+(a.file_path?'文件':'链接')+(a.file_size?' · '+e((Number(a.file_size)/1024/1024).toFixed(2))+' MB':'')+'</small>'+(a.description?'<p class="text muted">'+e(a.description)+'</p>':'')+'</li>';
  };
  const progress=(u:any)=>{
    const materials=u.assets||m.assets.filter((a:any)=>String(a.task_id)===String(u.task_id)&&assetLinksProgress(a,u.id));
    const label=({exempted:'合理补填',supplemented:'补填',late:'迟报'} as any)[u.status];
    return '<article class="progress"><header class="progress-head"><div><span class="metadata-label">工作日期</span><strong class="key-date">'+e(u.work_date)+'</strong>'+(label?badge(label,u.status==='exempted'?'supplement':'unknown'):'')+'</div><div class="progress-byline"><span>填报人：'+e(u.author_name||'未留存')+'</span><span>填报时间：<time>'+time(u.created_at)+'</time></span></div></header>'+
      '<div class="progress-evidence"><section class="progress-work"><h4>工作内容</h4><p class="work-content text">'+e(u.content)+'</p>'+
      (u.status==='exempted'?'<p class="supplement-reason">合理补填原因：'+e(u.exempt_reason||'未留存')+'</p>':'')+
      (u.risk?'<p class="text muted">记录中的风险：'+e(u.risk)+'</p>':'')+
      (u.next_plan?'<p class="text muted">当时的下一步计划：'+e(u.next_plan)+'</p>':'')+
      '</section><section class="progress-materials"><h4>对应资料</h4>'+
      (materials.length?'<ul class="materials">'+materials.map(asset).join('')+'</ul>':'<p class="material-explanation">'+(u.no_material_reason?'无资料原因：'+e(u.no_material_reason):'本条记录未关联资料。')+'</p>')+
      '</section></div></article>';
  };
  const task=(t:any,depth:number)=>{
    const records=ordered(t.updates,'work_date');
    const latest=[...records].reverse().find((u:any)=>u.work_date===t.latestWorkDate&&String(u.content||'').trim());
    const extraAssets=t.assets.filter((a:any)=>!t.updates.some((u:any)=>assetLinksProgress(a,u.id)));
    const timingNote=t.kind==='supplement'?'系统验收记录晚于截止 '+e(t.lateDays)+' 天，仅作留档，不据此认定实际工作延期。':t.lateDays?'<span class="delay-number">晚于截止 '+e(t.lateDays)+' 天</span>':'';
    const partial=t.kind==='late'&&t.updates.some((u:any)=>u.status==='exempted');
    return '<details class="task" id="task-'+e(t.id)+'" style="--task-depth:'+Math.min(depth,8)+'"><summary><div class="task-title-row"><div><span class="hierarchy-label">'+(depth?'子任务':'独立任务')+'</span><strong class="task-name">'+e(t.title)+'</strong></div><div class="task-meta">'+badge(t.label,t.kind)+toggleHint+'</div></div>'+
      '<div class="task-people">执行人：'+e(names(t,'assignee'))+'　验收人：'+e(names(t,'acceptor'))+'<span>'+(m.hasEvidence?t.updates.length+' 条进展 · '+t.assets.length+' 份资料':'进展资料待留存')+'</span></div>'+
      '<div class="task-dates">'+dateFact('最后进展工作日期',t.latestWorkDate||'未留存')+dateFact('最后填报时间',time(t.lastSubmittedAt))+'</div>'+
      (latest?'<p class="task-preview"><span>最近工作记录</span>'+e(latest.content)+'</p>':'')+'</summary>'+
      '<div class="task-body"><div class="task-plan">'+dateFact('计划开始',t.start_at||'未留存')+dateFact('计划截止',t.due_at||'未留存')+dateFact('系统验收完成',time(t.completed_at),timingNote)+'</div>'+
      (partial?'<p class="partial-note">部分进展已确认合理补填；其余记录未满足整项合理补填条件，任务仍列为延期完成。</p>':'')+
      (t.description?'<p class="text muted">'+e(t.description)+'</p>':'')+
      '<section class="work-records" aria-label="工作进展与对应资料"><h3>工作进展与对应资料</h3>'+records.map(progress).join('')+
      (records.length?'':'<p class="empty">'+(m.hasEvidence?'本任务未留存工作进展。':evidenceNote)+'</p>')+'</section>'+
      (extraAssets.length?'<section class="unlinked-materials"><h4>其他任务资料</h4><ul class="materials">'+extraAssets.map(asset).join('')+'</ul></section>':'')+'</div></details>';
  };
  const taskTree=reportHierarchy(allTasks.filter((t:any)=>t.status!=='cancelled')).map(row=>{
    const leaf=leafById.get(String(row.task.id));
    if(leaf) return task(leaf,row.depth);
    return '<header class="task-parent" style="--task-depth:'+Math.min(row.depth,8)+'"><span class="hierarchy-label">'+(row.depth?'子任务组':'主任务')+'</span><h3>'+e(row.task.title)+'</h3></header>';
  }).join('');
  const lateRows=m.lateTasks.map((t:any)=>['<a href="#task-'+e(t.id)+'">'+e(pathFor(t.id,t.title))+'</a>',e(names(t,'assignee')),e(t.due_at),e(t.completedDate),'<strong class="delay-number">'+e(t.lateDays)+' 天</strong>']);
  const alerts=Array.isArray(d.timingAlerts)?d.timingAlerts:[];
  const attention=(lateRows.length?table(['延期任务','执行人','计划截止','验收日期','晚了多久'],lateRows):'')+
    (alerts.length?'<div class="attention"><h3>结项时间需跟进</h3><ul>'+alerts.map((v:any)=>'<li>'+e(v)+'</li>').join('')+'</ul><p>请 HR 和领导向项目负责人了解情况。</p></div>':'')+
    (m.counts.unknown?'<p class="reason">'+m.counts.unknown+' 项任务的日期依据不完整，暂无法判断是否按期完成。</p>':'');
  const schedule=table(['日期事项','记录日期 / 时间','说明'],[
    ['计划开始','<strong class="key-date">'+e(d.project?.start_at||'未留存')+'</strong>','批准计划的开始日期'],
    ['批准截止','<strong class="key-date">'+e(d.plannedEnd||d.project?.end_at||'未留存')+'</strong>','批准计划的最晚完成日期'],
    ['任务全部验收','<strong class="key-date">'+time(d.completedAt)+'</strong>','全部任务在系统中通过验收；不等同实际工作完成日期'+(d.lateDays>0?'。晚于批准截止 '+e(d.lateDays)+' 天':'')],
    ['申请结项','<strong class="key-date">'+time(d.requestedAt||r.requested_at||r.created_at)+'</strong>',e(d.requester?.name||'申请人未留存')+(d.waitingDays>0?'；距全部验收完成 '+e(d.waitingDays)+' 天':'')],
    ['结项生效','<strong class="key-date">'+(['approved','voided'].includes(state)?time(d.closedAt||r.reviewed_at):'尚未生效')+'</strong>',e(d.approver?.name||'审批人未留存')+(d.approvalWaitingDays>0?'；审批等待 '+e(d.approvalWaitingDays)+' 天':'')],
  ])+(d.approvalLateOnly?'<p class="reason">申请按时，审批生效晚于计划。</p>':'');

  // 变更为对照表；记录之间没有依赖关系，不绘制流程连线。
  const changeItem=(i:any)=>{
    const kind=i.change_type||i.changeType, before=i.before||{},after=i.after||{};
    const label=({date:'调整日期',delete:'删除任务',add:'新增任务',assignee:'调整执行人',acceptor:'调整验收人',reorder:'调整顺序'} as any)[kind]||'计划调整';
    const title=i.task_title||tasksById.get(String(i.task_id))?.title||after.title||'任务';
    const range=(v:any)=>(v.startAt||'未设置')+' 至 '+(v.dueAt||'未设置');
    const personNames=(v:any,role:string)=>{
      const ids=v[role==='assignee'?'assigneeIds':'acceptorIds']||[];
      return ids.map((id:any)=>{
        const found=allTasks.flatMap((t:any)=>t.participants||[]).find((p:any)=>String(p.userId??p.user_id??p.id)===String(id));
        return found?.name||'历史人员姓名未留存';
      }).join('、')||'未设置';
    };
    const value=(v:any)=>kind==='reorder'?'顺序 '+(v.sortOrder??'未留存'):['assignee','acceptor'].includes(kind)?personNames(v,kind):range(v);
    return [e(title),e(label),kind==='add'?'—':e(value(before)),kind==='delete'?'已删除':e(value(after))];
  };
  const changes=ordered(d.changes||[],'created_at');
  const changesHtml=changes.map((c:any)=>'<article class="appendix-record"><header><strong>'+e(({approved:'变更已通过',rejected:'变更已退回',pending:'变更待审批',cancelled:'变更已撤销'} as any)[c.status]||'计划变更')+'</strong><time>'+time(c.created_at)+'</time></header>'+
    (c.reason?'<p class="text">'+e(c.reason)+'</p>':'')+table(['任务','变更事项','调整前','调整后'],(c.items||[]).map(changeItem))+'</article>').join('');

  const delayGroups=new Map<string,{title:string;rows:any[]}>();
  for(const item of ordered(d.delays||[],'observed_at')){
    const key=item.task_id!=null?'task:'+item.task_id:'project:'+(item.kind||'unknown');
    if(!delayGroups.has(key)) delayGroups.set(key,{title:item.task_id!=null?pathFor(item.task_id,item.snapshot?.title||'历史任务'):item.snapshot?.title||'项目延期记录',rows:[]});
    delayGroups.get(key)!.rows.push(item);
  }
  const delayHtml=Array.from(delayGroups.values()).map(group=>'<section class="delay-subject"><h4>'+e(group.title)+'<small>'+group.rows.length+' 次记录</small></h4>'+
    table(['记录日期','计划截止','截至当天已超期','最终情况'],group.rows.map((v:any)=>{
      const task=leafById.get(String(v.task_id));
      const conclusion=task?badge(task.label,task.kind):v.task_id!=null?'汇总任务，仅供核对':'整个项目的验收进度';
      return [time(v.observed_at),e(v.snapshot?.dueAt||'未留存'),e(v.snapshot?.days??v.days??'—')+' 天',conclusion];
    }))+group.rows.map((v:any)=>{
      const rows=ordered(v.history||[],'created_at').map((h:any)=>[time(h.created_at),e(h.user_name||h.handler_name||h.actor_name||'未留存'),e(({open:'待处理',processing:'处理中',resolved:'已处理'} as any)[h.status]||'处理记录'),e(h.comment||h.reason||'未留存')]);
      return rows.length?'<div class="handling-records"><h5>对 '+time(v.observed_at)+' 记录的处理</h5>'+table(['处理时间','处理人','处理状态','说明'],rows)+'</div>':'';
    }).join('')+'</section>').join('');
  const baseline=reportHierarchy(d.firstPlan?.tasks||[]);
  const baselineHtml=table(['任务层级','所属父任务','计划开始','计划截止'],baseline.map(row=>{
    const p=(d.firstPlan.tasks||[]).find((t:any)=>String(t.id)===String(row.task.parent_id));
    const label=row.hasChildren?(row.depth?'子任务组':'主任务'):(row.depth?'子任务':'独立任务');
    return ['<span class="baseline-task '+(row.hasChildren?'is-parent':'')+'" style="padding-inline-start:'+Math.min(row.depth,8)*20+'px"><span class="hierarchy-label">'+label+'</span>'+e(row.task.title)+'</span>',e(p?.title||'—'),e(row.task.start_at),e(row.task.due_at)];
  }));
  const notices=options.embedded?(r.supplementNotices||d.supplementNotices||[]):(d.supplementNotices||[]);
  const noticeHtml=table(['任务 / 事项','确认时间','工作日期','原因 / 更正说明','知晓情况'],ordered(notices,'created_at').map((n:any)=>{
    const p=n.payload||{},s=p.supplement||{};
    return [e(s.taskTitle||pathFor(p.taskId,p.title||n.title||'补填记录')),time(n.created_at),e(s.workDate||'未留存'),
      s.reason||s.content?'<p class="text">'+e(s.reason||'原因未留存')+'</p>'+(p.revokedAt||p.correctionOf?'<p>'+e(p.title||'补填标记已更正')+'</p>':''):
      '<p class="text">'+e(p.text||n.content||n.summary||n.reason||'未留存说明')+'</p>',
      e(n.recipient_name||'接收人未留存')+' · '+(n.acknowledged_at?'已知晓 '+time(n.acknowledged_at):'待知晓')];
  }));
  // 补填确认是否闭合属于 HR 与内控要看的风险，不埋在明细里。
  const pendingAcks=notices.filter((n:any)=>n.acknowledged_at==null).length;
  const auditFacts=[['报告编号',d.reportNumber||r.report_number],['版本',d.version||r.version],['申请人',d.requester?.name||r.requester_name],['审批人',d.approver?.name||r.approver_name],['审批时间',d.closedAt||r.reviewed_at?time(d.closedAt||r.reviewed_at):null],['最后业务操作',d.lastActivityAt?time(d.lastActivityAt):null],['首次定稿截止',d.firstPlanEnd]].filter(([,v])=>v!=null&&v!=='');
  const audit='<dl class="facts">'+auditFacts.map(([k,v])=>'<div><dt>'+e(k)+'</dt><dd>'+e(v)+'</dd></div>').join('')+'</dl>'+
    '<p class="muted">完成分布只统计有效叶子任务，父任务不重复计数。日期采用北京时间，时间差按自然日计算。合理补填单独列示，系统验收时间不替代实际工作日期。</p>'+
    (d.approvalComment?'<p class="text">审批意见：'+e(d.approvalComment)+'</p>':'')+
    (d.delayReason?'<p class="text">历史申请说明：'+e(d.delayReason)+'</p>':'')+
    (d.overdueReason?'<p class="text">历史超期说明：'+e(d.overdueReason)+'</p>':'');
  const distinctMaterialReasons=m.tasks.filter((t:any)=>t.material_exemption_reason&&!t.updates.some((u:any)=>String(u.no_material_reason||'').trim()===String(t.material_exemption_reason).trim()));
  const history=(changes.length?disclosure('计划变更 · '+changes.length+' 条',changesHtml):'')+
    (delayGroups.size?disclosure('过去的延期记录','<p class="archive-explanation">这是系统在不同日期保存的延期情况。例如前一天超期 8 天、次日超期 9 天，是同一次延期的持续记录，不能相加。当前结论请看上方项目总览。</p>'+delayHtml):'')+
    (baseline.length?disclosure('首次定稿计划','<p class="archive-explanation">首次批准时保存的计划，用于与后续变更核对；以下保留原有父子任务关系。</p>'+baselineHtml):'')+
    (notices.length?disclosure('合理补填确认与知晓',noticeHtml):'')+
    (distinctMaterialReasons.length?disclosure('验收时补充的资料说明',table(['任务','说明'],distinctMaterialReasons.map((t:any)=>[e(pathFor(t.id,t.title)),e(t.material_exemption_reason)]))):'')+
    (m.otherUpdates.length?disclosure('父任务及历史任务的工作记录',ordered(m.otherUpdates,'work_date').map((u:any)=>'<div class="historic-progress"><h4>'+e(pathFor(u.task_id,'历史任务'))+'</h4>'+progress(u)+'</div>').join('')):'')+
    disclosure('报告依据与审批信息',audit);

  const brief=executiveReport(m);
  const compactAsset=(a:any)=>'<ul class="materials compact-material">'+asset(a)+'</ul>';
  const outputExamples=brief.outcomeAssets.slice(0,4);
  const completionText=brief.completion;
  // 数字重点条：领导一眼扫结论，句子只留一句，构成不写成段落。
  const counts=m.counts;
  const statTile=(label:string,value:string,note:string,tone='')=>'<div class="stat-tile'+(tone?' stat-'+tone:'')+'"><span class="stat-label">'+e(label)+'</span><strong class="stat-value">'+e(value)+'</strong>'+(note?'<span class="stat-note">'+e(note)+'</span>':'')+'</div>';
  const statTiles=[statTile('任务完成',brief.completed+' / '+m.total,''),statTile('按期完成',(counts.ontime||0)+' 项',counts.ontime?'':'无一项按期',counts.ontime?'':'risk')];
  if(counts.unfinished)statTiles.push(statTile('未完成',counts.unfinished+' 项','','risk'));
  if(counts.late)statTiles.push(statTile('延期完成',counts.late+' 项',m.lateTasks[0]?.lateDays?'最长 '+m.lateTasks[0].lateDays+' 天':'','risk'));
  if(counts.unknown)statTiles.push(statTile('日期待核实',counts.unknown+' 项','','warn'));
  if(brief.outcomeCount)statTiles.push(statTile('交付资料',brief.outcomeCount+' 份',''));
  if(pendingAcks)statTiles.push(statTile('补填待知晓',pendingAcks+' 条','需领导确认','warn'));
  const statBand='<div class="stat-band">'+statTiles.join('')+'</div>';
  const overview='<header id="overview" class="report-cover"><div class="masthead"><span>'+ (r.report?'项目总结报告':'结项申请') +'</span>'+badge(status[state],state)+'</div><h1>'+e(d.project?.name||'项目总结报告')+'</h1><div class="meta">'+
    [d.project?.dept_name||d.project?.department_name,(d.owners||[]).length?'负责人：'+d.owners.map((v:any)=>v.name).join('、'):null].filter(Boolean).map(v=>'<span>'+e(v)+'</span>').join('')+'</div></header>'+
    (state==='voided'?'<p class="invalid">原结项报告已失效，请以重新审批后的报告为准。</p>':'')+
    '<section class="executive-brief" aria-label="项目总览"><div class="visual-verdict"><div><h2>项目总览</h2><strong>'+e(completionText)+'</strong></div><div><span>是否按期</span>'+badge(brief.schedule,brief.tone)+'</div></div>'+
    statBand+
    '<div class="overview-charts">'+completionChart(m,brief)+delayChart(m,pathFor)+'</div>'+
    '<div class="brief-dates">'+dateFact('计划截止',d.plannedEnd||d.project?.end_at||'未留存')+dateFact('最后工作日期',brief.latestWorkDate||'未留存')+dateFact('验收完成',time(d.completedAt))+'</div>'+
    '</section>';
  const resultRows=brief.results.map(g=>{
    const children=g.tasks.length!==1||String(g.tasks[0]?.id)!==g.id;
    const heading=children?'<tr class="result-group"><th colspan="4" scope="rowgroup">'+e(g.title)+'<span>'+g.completed+' / '+g.tasks.length+' 项完成</span></th></tr>':'';
    return heading+g.tasks.map((t:any)=>'<tr><th scope="row"><a href="#task-'+e(t.id)+'">'+e(t.title)+'</a><small>'+e(names(t,'assignee'))+'</small></th>'+
      '<td>'+badge(t.label,t.kind)+'</td><td><p class="result-content">'+(t.latest?e(reportExcerpt(t.latest.content,180)):'未留存工作内容')+'</p>'+
      (t.latest?'<small>工作日期 <strong>'+e(t.latest.work_date)+'</strong> · 最近一条记录</small>':'')+'</td>'+
      '<td>'+(t.assets.length?'<ul class="result-assets">'+t.assets.slice(0,2).map((a:any)=>'<li>'+compactAsset(a)+'</li>').join('')+'</ul>'+
        (t.assets.length>2?'<a href="#task-'+e(t.id)+'">另有 '+(t.assets.length-2)+' 份资料</a>':''):
        '<span class="muted">'+e(reportExcerpt(t.latest?.no_material_reason||t.material_exemption_reason||'未留存交付资料',90))+'</span>')+'</td></tr>').join('');
  }).join('');
  const results='<div class="deliverables-heading"><p>交付资料 <strong>'+ (m.hasEvidence?brief.outcomeCount+' 份':'未留存') +'</strong></p>'+
    (brief.outcomeCount>4?'<a href="#assets">查看全部资料</a>':'')+'</div>'+
    (outputExamples.length?'<ul class="deliverable-list">'+outputExamples.map(a=>'<li><span class="document-kind" aria-hidden="true">'+(a.file_path?'文件':'链接')+'</span><div>'+compactAsset(a)+'<p class="deliverable-owner">'+e(pathFor(a.task_id,'项目资料'))+'</p></div></li>').join('')+'</ul>':
    '<p class="empty">'+(m.hasEvidence?'暂无交付资料，可展开下方任务成果查看工作结果。':'本报告未留存交付资料。')+'</p>')+
    disclosure('任务成果摘要 · '+m.total+' 项',resultRows?'<div class="table-wrap"><table class="results-table"><thead><tr><th scope="col">任务 / 执行人</th><th scope="col">完成情况</th><th scope="col">工作结果摘要</th><th scope="col">交付资料 / 说明</th></tr></thead><tbody>'+resultRows+'</tbody></table></div>':'<p class="empty">本报告未留存任务成果。</p>');
  const pointRows=brief.points.map(p=>[e(p.date),e(p.title),e(p.kind),'<p class="text">'+e(p.content)+'</p>']);
  const focus='<div class="focus-summary">'+
    (m.lateTasks.length?'<a href="#delay-details"><strong>'+m.lateTasks.length+'</strong> 项延期任务 · 查看明细</a>':'<span>无普通延期任务</span>')+
    (alerts.length?'<a href="#timing-details"><strong>'+alerts.length+'</strong> 项结项时间提醒</a>':'')+
    (m.counts.supplement?'<span>'+m.counts.supplement+' 项已确认合理补填</span>':'')+
    (pendingAcks?'<span>'+pendingAcks+' 条补填确认待领导知晓</span>':'')+'</div>'+
    (brief.points.length?'<ul class="milestone-notes">'+brief.points.slice(0,3).map(p=>'<li><time>'+e(p.date)+'</time><strong>'+e(p.title)+'</strong><p>'+e(reportExcerpt(p.content,60))+'</p></li>').join(''):'')+
    (attention?disclosure('延期与结项提醒详情','<div id="delay-details"><div id="timing-details">'+attention+'</div></div>'):'')+
    (pointRows.length?disclosure('查看全部 '+pointRows.length+' 条过程事项',table(['工作 / 记录日期','相关任务','事项','记录内容'],pointRows)):'')+
    (d.approvalComment?disclosure('结项审批意见','<p class="text">'+e(d.approvalComment)+'</p>'):'');
  const assetDirectory=table(['所属任务','交付资料'],m.assets.map((a:any)=>[e(pathFor(a.task_id,'项目资料')),compactAsset(a)]));
  const evidence=disclosure('全部任务进展与资料',taskTree)+
    disclosure('项目计划与结项记录',schedule)+
    (m.assets.length?disclosure('完整资料目录 · '+m.assets.length+' 份','<div id="assets">'+assetDirectory+'</div>'):'')+
    disclosure('计划变更及历史记录',history);
  const navItems=[['overview','项目总览'],['results','成果全貌'],['attention','延期与关键事项'],['evidence','详细依据']];
  const nav='<aside class="report-sidebar"><nav class="nav" aria-label="报告目录"><strong>报告目录</strong><small>点击跳转</small>'+navItems.map(([id,label])=>'<a class="nav-link" href="#'+id+'"><span>'+label+'</span><span class="nav-action">查看</span></a>').join('')+'</nav></aside>';
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>'+e(d.project?.name||'项目')+' · 项目总结报告</title><style>'+reportStyle+'</style></head><body><div class="report'+(options.embedded?' embedded':'')+'">'+nav+'<main class="report-content">'+overview+
    section('results','成果全貌',results)+section('attention','延期与关键事项',focus)+
    section('evidence','详细依据',evidence,'需要核查时展开；完整工作记录与历史信息均保留。')+
    '<footer class="footer">依据结项时保存的项目记录生成。历史补录与普通延期分开列示；验收日期不替代实际工作日期。</footer></main></div></body></html>';
}
