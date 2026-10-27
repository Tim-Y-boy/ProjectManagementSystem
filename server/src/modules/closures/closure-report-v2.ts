import { reportModel, reportHierarchy, reportDate } from './closure-report-model';
import { executiveReport } from './closure-report-summary';
import { completionChart } from './closure-report-charts';
import { closureReportV2Style } from './closure-report-v2-style';

const e = (v: any) => String(v ?? '—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day = (v: any) => e(reportDate(v) || '—');
const paragraph = (v: any) => `<p class="para narrative">${e(v)}</p>`;
const table = (headers: string[], rows: string[][]) => `<div class="tbl-wrap"><table class="tbl"><thead><tr>${headers.map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const section = (id: string,num: string,title: string,body: string) => `<section class="sec" id="${id}"><div class="sec-head"><span class="sec-num">${num}</span><h2 class="sec-title">${title}</h2></div>${body}</section>`;
const extraStyle = `
td,th{overflow-wrap:anywhere}.file-link{border:0;background:none;color:var(--accent);text-decoration:underline;cursor:pointer;font:inherit;text-align:left}
figure{margin:0}.completion-chart figcaption{font-weight:700;color:var(--ink);font-size:16px}.completion-chart figcaption small{display:none}
.donut-layout{display:flex;align-items:center;gap:24px;margin:18px 0}.donut-layout svg{width:140px;flex:none}.donut-value{font:bold 27px Georgia;fill:var(--ink)}.donut-label{font:11px sans-serif;fill:var(--muted)}
.chart-legend{list-style:none;padding:0;flex:1}.chart-legend li{display:flex;gap:8px;align-items:center;margin:10px 0;font-size:13px}.chart-legend i{width:9px;height:9px;border-radius:50%}.chart-legend strong{margin-left:auto}.chart-note{font-size:11px;color:var(--muted)}
.record{padding:14px 0;border-bottom:1px solid var(--line)}.record header{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12px}.record header strong{color:var(--ink)}
details{border:1px solid var(--line);border-radius:5px;margin-top:12px;padding:12px 16px}summary{cursor:pointer;font-weight:600;color:var(--ink)}.task-parent{background:var(--th-bg);font-weight:700}.date-number{font-size:23px!important;white-space:nowrap}.approval-table td{white-space:pre-wrap}.invalid{color:#ad3449;font-weight:bold}.signoff{flex-wrap:wrap}
@media(max-width:650px){.doc{margin:0;padding:24px 18px}.date-number{font-size:20px!important}.donut-layout{gap:12px}.donut-layout svg{width:120px}}`;

export function renderClosureReportV2(r: any, options: {embedded?:boolean} = {}) {
  const m=reportModel(r), d=m.data, brief=executiveReport(m), a=d.application || {}, w=d.workflow;
  const states: Record<string,string>={approved:'已结项',voided:'报告已失效',rejected:'已退回',withdrawn:'已撤回',pending:w.stage==='final'?'待总经理终审':'审核中'};
  const status=states[r.status]||'申请预览';
  const ownerNames=(d.owners||[]).map(o=>o.name).join('、');
  const people=[...new Set<string>((d.tasks||[]).flatMap(t=>(t.participants||[]).filter(p=>p.role==='assignee').map(p=>p.name)))].join('、');
  const assetLink=(file:any,charter=false)=>{
    const title=e(file.original_name||file.title||'资料');
    if(file.file_path) return options.embedded?`<button type="button" class="file-link" data-${charter?'charter':'asset'}-id="${e(file.id)}">${title}</button>`:`${title} <small>（在系统内下载）</small>`;
    try { const url=new URL(file.url); if(['http:','https:'].includes(url.protocol))return `<a href="${e(url.href)}" target="_blank" rel="noopener noreferrer">${title}</a>`; } catch {}
    return title;
  };
  const basic=table(['项目事项','内容'],[
    ['项目名称',e(d.project?.name)],['所属部门',e(d.project?.dept_name)],['项目负责人',e(ownerNames)],['执行人',e(people||'未留存')],
    ['计划起止日期',`${day(d.project?.start_at)} 至 ${day(d.plannedEnd||d.project?.end_at)}`],
    ['申请日期',day(r.requested_at||d.requestedAt)],['结项日期',r.report?day(d.closedAt):'尚未结项'],
    ['立项依据',a.charters?.length?a.charters.map(f=>assetLink(f,true)).join('<br>'):`无立项书：${e(a.noCharterReason)}`],
  ]);
  const overview=`<div class="exec-overview"><div class="exec-panel">${completionChart(m,brief)}<p class="exec-note">按有效末级任务统计，主任务不重复计入。</p></div><div class="exec-panel"><h3 class="exec-title">项目是否按期</h3><p class="status-line"><span class="badge ${brief.tone==='late'?'warn':'ok'}">${e(brief.schedule)}</span></p><div class="exec-dates"><div><small>批准截止日期</small><strong class="date-number">${day(d.plannedEnd||d.project?.end_at)}</strong></div><div class="actual"><small>系统全部验收日期</small><strong class="date-number">${day(d.completedAt)}</strong></div></div><p class="exec-note">按系统验收记录比较计划；工作日期与补填确认在下方单列。</p></div></div>`;
  const byId=new Map<string,any>(m.tasks.map(t=>[String(t.id),t]));
  const taskRows=reportHierarchy((d.tasks||[]).filter(t=>t.status!=='cancelled')).map(({task,depth})=>{
    const leaf=byId.get(String(task.id));
    return [`<span style="padding-left:${Math.min(depth,8)*16}px" class="${leaf?'':'task-parent'}">${e(task.title)}</span>`,day(leaf?.latestWorkDate),day(task.due_at),day(task.completed_at),leaf?e(leaf.label):'主任务汇总'];
  });
  const progress=(m.updates||[]).map(u=>{
    const task=(d.tasks||[]).find(t=>String(t.id)===String(u.task_id));
    return `<article class="record"><header><strong>${day(u.work_date)}</strong><span>${e(task?.title)}</span><span>填报人：${e(u.author_name)}</span><span>填报日期：${day(u.created_at)}</span></header>${paragraph(u.content)}${u.status==='exempted'?`<p class="note">合理补填：${e(u.exempt_reason||'已确认')}</p>`:''}</article>`;
  }).join('');
  const materials=[...new Map<string,any>(m.assets.map(f=>[String(f.id),f])).values()];
  const execution=overview+`<h3 class="sub-title">进度执行情况</h3>`+table(['任务','最后进展日期','计划截止','系统验收','完成情况'],taskRows)
    +(progress?`<details><summary>查看关键进展（${m.updates.length} 条）</summary>${progress}</details>`:'')
    +`<h3 class="sub-title">质量与交付物情况</h3>`+(materials.length?table(['序号','交付物名称','类型'],materials.map((f,i)=>[String(i+1),assetLink(f),f.file_path?'文件':'链接'])):'<p class="note">未上传交付资料，具体成果见下文。</p>');
  const reviewRows=w.reviews.map(x=>[e((x.departmentName?x.departmentName+' · ':'')+x.name),e(({pending:'待审核',approved:'通过',rejected:'退回'})[x.status]),e(x.comment||'—'),day(x.reviewedAt),x.sourceRequestId?`沿用申请 #${e(x.sourceRequestId)} 的审核`:'本次审核']);
  reviewRows.push([`总经理（最后一级）：${e(d.approver?.name)}`,w.finalDecision==='approved'?'通过':w.finalDecision==='rejected'?'退回':w.stage==='final'?'待终审':'待前置审核完成',e(d.approvalComment||((w.finalDecision)?r.review_comment:null)||'—'),day(w.finalDecision?(d.closedAt||r.reviewed_at):null),'总经理终审']);
  const checklists=w.version===3?w.reviews.map(review=>`<h3 class="sub-title">${e(review.departmentName)} · 审核清单</h3>`+table(['核验事项','结果','说明'],(review.checklist||[]).map((text,i)=>[e(text),e(({yes:'符合',no:'不符合',na:'不适用'})[review.checklistResults?.[i]?.answer]||'待核验'),e(review.checklistResults?.[i]?.note||'—')]))).join(''):'';
  const approvals=`<div class="approval-table">${table(['审核人','审核结果','审核意见','审核日期','说明'],reviewRows)}</div>`+checklists;
  const sections=section('s1','一','基本信息',basic)+section('s2','二','项目背景与目标',`<h3 class="sub-title">项目背景</h3>${paragraph(a.background)}<h3 class="sub-title">项目目标</h3>${paragraph(a.objective)}`)
    +section('s3','三','项目执行情况（进度与质量）',execution)+section('s4','四',w.version===3?'项目实际成果':'项目成果',paragraph(a.outcome))+section('s5','五','审核记录',approvals);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(d.project?.name)} · 项目结项报告</title><style>${closureReportV2Style}${extraStyle}</style></head><body><main class="doc"><header class="doc-head"><div class="head-meta"><span>申请编号：${e(r.id)}</span><span>日期：${day(d.closedAt||r.requested_at)}</span></div><h1 class="doc-title">${e(d.project?.name)}</h1><p class="doc-sub">项目结项报告${r.report?'':' · 申请预览'}</p><div class="status-line"><span class="badge ${r.status==='voided'?'warn':'ok'}">${e(status)}</span></div></header><nav class="toc">${['基本信息','项目背景与目标','项目执行情况','项目成果','审核记录'].map((v,i)=>`<a class="nav-link" href="#s${i+1}">${v}</a>`).join('')}</nav>${sections}<footer class="signoff"><span>项目负责人：${e(ownerNames)}</span><span>总经理终审：${e(d.approver?.name)}</span><span>日期：${day(d.closedAt||r.requested_at)}</span></footer></main></body></html>`;
}
