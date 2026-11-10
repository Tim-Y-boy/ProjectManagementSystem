import { reportModel, reportKinds } from './closure-report-model';
import { executiveReport } from './closure-report-summary';
const escape=(value:any)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors:Record<string,string>={ontime:'#278475',late:'#be4857',supplement:'#637fa8',unknown:'#b87919',unfinished:'#667580'};
type Model=ReturnType<typeof reportModel>;
type Brief=ReturnType<typeof executiveReport>;
export function completionChart(m:Model,brief:Brief) {
  if(!m.total)return '<figure class="report-chart completion-chart"><figcaption>任务完成情况</figcaption><p class="chart-empty">暂无任务数据</p></figure>';
  let offset=0;
  const segments=Object.entries(m.counts).filter(([,count])=>count>0).map(([kind,count])=>{
    const size=count/m.total*100,segment='<circle cx="80" cy="80" r="60" pathLength="100" fill="none" stroke="'+colors[kind]+'" stroke-width="18" stroke-dasharray="'+size+' '+(100-size)+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 80 80)" />';
    offset+=size;return segment;
  }).join('');
  const percent=Math.round(brief.completed/m.total*100);
  const legend=Object.entries(m.counts).filter(([,count])=>count>0).map(([kind,count])=>'<li><i style="background:'+colors[kind]+'"></i><span>'+escape(reportKinds[kind])+'</span><strong>'+count+' 项</strong></li>').join('');
  return '<figure class="report-chart completion-chart"><figcaption>任务完成情况 <small>按完成方式划分</small></figcaption><div class="donut-layout"><svg viewBox="0 0 160 160" role="img" aria-label="已完成 '+brief.completed+' 项，共 '+m.total+' 项，完成率 '+percent+'%">'+segments+'<text x="80" y="79" text-anchor="middle" class="donut-value">'+percent+'%</text><text x="80" y="100" text-anchor="middle" class="donut-label">已完成 '+brief.completed+' / '+m.total+'</text></svg><ul class="chart-legend">'+legend+'</ul></div><p class="chart-note">环图按完成方式划分，中心数字为任务完成率。</p></figure>';
}
export function delayChart(m:Model,path:(id:any,fallback:string)=>string) {
  const rows=m.lateTasks.slice(0,5),max=Math.max(1,...rows.map((t:any)=>t.lateDays||0));
  const bars=rows.map((t:any)=>'<li><div class="bar-caption"><a href="#task-'+escape(t.id)+'">'+escape(path(t.id,t.title))+'</a><strong>'+t.lateDays+' 天</strong></div><div class="bar-track" aria-hidden="true"><span class="delay-fill" style="width:'+(t.lateDays/max*100)+'%"></span></div></li>').join('');
  return '<figure class="report-chart delay-chart"><figcaption>延期与关注 <small>延期任务'+(m.lateTasks.length>5?' · 前 5 项':'')+'</small></figcaption>'+
    (bars?'<ol class="bar-list">'+bars+'</ol><p class="chart-note">验收晚于截止的天数；合理补填单独列示。</p>':'<p class="chart-empty">'+(m.counts.unfinished||m.counts.unknown?'未完成或日期待核实，暂无可比较的延期天数。':'无普通延期任务')+'</p>')+
    (m.lateTasks.length>5?'<a class="more-link" href="#attention">查看全部 '+m.lateTasks.length+' 项延期</a>':'')+'</figure>';
}
