import { assetLinksProgress } from '../tasks/task-asset-links';
import { reasonableSupplementDisabledReason } from '../tasks/reasonable-supplement';

export const reportDate = (value: any): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
};
const validDay = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
export const reportKinds = {ontime:'正常完成',late:'延期完成',supplement:'已确认合理补填',unknown:'依据不完整',unfinished:'未完成'};

// 只使用本张报告的快照；不读取当前项目状态，不将父任务和子任务重复计数。
export function reportModel(request: any) {
  const data = request.report || request.snapshot || {};
  const all = data.tasks || [], updates = data.updates || [], assets = data.assets || [];
  const active = all.filter((t: any) => t.status !== 'cancelled');
  const parents = new Set(active.map((t: any) => String(t.parent_id)));
  const byId = new Map<string,any>(all.map((t: any) => [String(t.id),t]));
  const tasks = active.filter((t: any) => !parents.has(String(t.id))).map((t: any) => {
    const progress = updates.filter((u: any) => String(u.task_id)===String(t.id)).map((u: any)=>({...u,assets:assets.filter((a:any)=>String(a.task_id)===String(t.id)&&assetLinksProgress(a,u.id))}));
    const material = assets.filter((a: any)=>String(a.task_id)===String(t.id));

    const workDates=progress.map((u:any)=>u.work_date).filter(validDay).sort();
    const submitted=progress.map((u:any)=>u.created_at).filter((v:any)=>v&&Number.isFinite(new Date(v).getTime())).sort((a:any,b:any)=>Date.parse(a)-Date.parse(b));
    const latestWorkDate=workDates.length?workDates[workDates.length-1]:null;
    const lastSubmittedAt=submitted.length?submitted[submitted.length-1]:null;
    const completed = reportDate(t.completed_at);
    const days = validDay(t.due_at) && completed ? Math.max(0,Math.round((Date.parse(completed)-Date.parse(t.due_at))/86400000)) : null;
    const exempted = progress.some((u:any)=>u.status==='exempted') && progress.every((u:any)=> {
      if (!validDay(u.work_date) || !validDay(t.due_at) || u.work_date>t.due_at || !reportDate(u.created_at)) return false;
      return u.status==='exempted' ? !reasonableSupplementDisabledReason(t.due_at,{workDate:u.work_date,createdAt:u.created_at}) : reportDate(u.created_at)! <= t.due_at;
    });
    const kind = t.status!=='done' ? 'unfinished' : days==null ? 'unknown' : days===0 ? 'ontime' : exempted ? 'supplement' : 'late';
    let root=t; const seen=new Set([String(t.id)]);
    while(root.parent_id!=null&&byId.has(String(root.parent_id))&&!seen.has(String(root.parent_id))) {root=byId.get(String(root.parent_id));seen.add(String(root.id));}
    return {...t,latestWorkDate,lastSubmittedAt,kind,label:reportKinds[kind],lateDays:days,completedDate:completed,updates:progress,assets:material,groupId:String(root.id),groupTitle:root.title};
  });
  const groups: Array<{id:string;title:string;tasks:any[]}> = [];
  for(const t of tasks){let g=groups.find(g=>g.id===t.groupId);if(!g){g={id:t.groupId,title:t.groupTitle,tasks:[]};groups.push(g);}g.tasks.push(t);}
  const counts = Object.fromEntries(Object.keys(reportKinds).map(k=>[k,tasks.filter((t:any)=>t.kind===k).length])) as Record<keyof typeof reportKinds,number>;
  const ids=new Set(tasks.map((t:any)=>String(t.id)));
  return {data,tasks,groups,counts,total:tasks.length,cancelled:all.filter((t:any)=>t.status==='cancelled').length,
    updates,assets,hasEvidence:Array.isArray(data.updates)&&Array.isArray(data.assets),
    otherUpdates:updates.filter((u:any)=>!ids.has(String(u.task_id))),otherAssets:assets.filter((a:any)=>!ids.has(String(a.task_id))),
    lateTasks:tasks.filter((t:any)=>t.kind==='late').sort((a:any,b:any)=>(b.lateDays||0)-(a.lateDays||0)),
    materialTasks:tasks.filter((t:any)=>t.assets.length>0).length};
}


// 原始计划和结项任务使用相同的父子顺序；孤立记录、历史环形关系各保留一次。
export function reportHierarchy(tasks:any[]) {
  const byId=new Map(tasks.map(t=>[String(t.id),t]));
  const children=new Map<string,any[]>();
  for(const task of tasks) {
    if(task.parent_id==null || !byId.has(String(task.parent_id))) continue;
    const key=String(task.parent_id);
    if(!children.has(key)) children.set(key,[]);
    children.get(key)!.push(task);
  }
  const result:Array<{task:any;depth:number;hasChildren:boolean}>=[], visited=new Set<string>();
  const visit=(task:any,depth:number)=>{
    const key=String(task.id);
    if(visited.has(key)) return;
    visited.add(key);
    const descendants=(children.get(key)||[]).filter(t=>!visited.has(String(t.id)));
    result.push({task,depth,hasChildren:descendants.length>0});
    for(const child of descendants) visit(child,depth+1);
  };
  for(const task of tasks) if(task.parent_id==null||!byId.has(String(task.parent_id))) visit(task,0);
  for(const task of tasks) if(!visited.has(String(task.id))) visit(task,0);
  return result;
}
