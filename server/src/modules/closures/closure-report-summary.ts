import { reportDate, reportModel } from './closure-report-model';

const day = (v:any) => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && reportDate(v)===v ? v : null;
const plain = (v:any) => String(v||'').trim();
export const reportExcerpt = (value:any,limit=140) => {
  const chars=Array.from(plain(value).replace(/\s+/g,' '));
  return chars.length>limit?chars.slice(0,limit).join('')+'…':chars.join('');
};
// 摘要仅摘取快照中的事实；不把填报时间或最后进展推定成实际完工时间。
export function executiveReport(m:ReturnType<typeof reportModel>) {
  const exceptions=(m.counts.late||0)+(m.counts.supplement||0);
  const completed=m.tasks.filter((t:any)=>t.status==='done').length;
  const latest=(t:any)=>[...t.updates].filter((u:any)=>day(u.work_date)&&plain(u.content))
    .sort((a:any,b:any)=>a.work_date.localeCompare(b.work_date)||(Date.parse(a.created_at)||0)-(Date.parse(b.created_at)||0)).at(-1);
  const results=m.groups.map(g=>({
    id:g.id,title:g.title,
    tasks:g.tasks.map(t=>({...t,latest:latest(t)})),
    completed:g.tasks.filter(t=>t.status==='done').length,
    assets:m.assets.filter((a:any)=>g.tasks.some(t=>String(t.id)===String(a.task_id))||String(a.task_id)===g.id),
  }));
  const activeIds=new Set((m.data.tasks||[]).filter((t:any)=>t.status!=='cancelled').map((t:any)=>String(t.id)));
  const outcomeAssets=m.assets.filter((a:any)=>a.task_id==null||activeIds.has(String(a.task_id)));
  const projectDeadline=day(m.data.plannedEnd||m.data.project?.end_at);
  const completionDay=reportDate(m.data.completedAt);
  const projectLateDays=projectDeadline&&completionDay?Math.max(0,Math.round((Date.parse(completionDay)-Date.parse(projectDeadline))/86400000)):null;
  let schedule='按期完成',tone='ontime';
  if(!m.total){schedule='暂无完成依据';tone='unknown';}
  else if(m.counts.unfinished){schedule='仍有任务未完成';tone='unfinished';}
  else if(m.counts.late){schedule=projectLateDays===0?'项目按期完成，部分任务曾延期':projectLateDays!=null?'项目验收晚于计划 '+projectLateDays+' 天':m.counts.late+' 项任务延期完成';tone='late';}
  else if(m.counts.unknown){schedule='部分完成时间待核实';tone='unknown';}
  else if(m.counts.supplement){schedule=m.counts.supplement===m.total?'历史补录已确认':'无延期任务，含已确认补录';tone='supplement';}
  else if(projectLateDays==null){schedule='项目完成日期待核实';tone='unknown';}
  else if(projectLateDays>0){schedule='项目验收晚于计划 '+projectLateDays+' 天';tone='late';}
  const points:Array<{title:string;date:string;content:string;taskId?:any;kind:string}>=[];
  const seen=new Set<string>();
  // 相同任务重复填报同一风险，仅保留最新一次。
  for(const u of [...m.updates].sort((a:any,b:any)=>String(b.work_date||'').localeCompare(String(a.work_date||'')))){
    const content=plain(u.risk),key=String(u.task_id)+':'+content;
    if(!content||seen.has(key)) continue;
    seen.add(key);
    const task=(m.data.tasks||[]).find((t:any)=>String(t.id)===String(u.task_id));
    points.push({title:task?.title||'工作记录',date:day(u.work_date)||'日期未留存',content,taskId:u.task_id,kind:'执行中记录的问题'});
  }
  for(const c of m.data.changes||[]){
    if(c.status!=='approved'||!plain(c.reason))continue;
    points.push({title:'已批准的计划调整',date:reportDate(c.created_at)||'日期未留存',content:plain(c.reason),kind:'计划变化'});
  }
  points.sort((a,b)=>b.date.localeCompare(a.date));
  // 任务全部完成但无一按期时不能只报“已完成”，否则首屏会掩盖整项延期。
  const completion=!m.total?'暂无任务完成依据'
    :completed!==m.total?completed+' / '+m.total+' 项任务已完成'
    :exceptions===m.total?'全部 '+m.total+' 项已完成，均晚于计划'
    :'全部任务已完成';
  // 首屏只保留一句结论与数字重点条；构成明细交给结项报告的数字条，不再堆成句子。
  return {completed,results,schedule,tone,points,completion,
    latestWorkDate:m.tasks.map((t:any)=>t.latestWorkDate).filter(Boolean).sort().at(-1)||null,
    outcomeAssets,outcomeCount:outcomeAssets.length,projectLateDays,
  };
}
