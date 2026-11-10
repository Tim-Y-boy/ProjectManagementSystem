import { weekHasWorkdaySql } from '../holidays/work-calendar';

// Read effective content only. Proposed amendments live in a separate table.
export async function captureClosureWeeklyReports(m: { query: Function }, projectId: number) {
  return m.query(`SELECT r.id,r.project_id,r.week_start::text AS week_start,
    (r.week_start+6)::text AS week_end,r.overall_status,r.achievements,r.risks,
    r.coordination,r.next_week,r.version,r.submitted_at,
    u.name AS owner_name,u.avatar_url AS owner_avatar_url
    FROM project_weekly_reports r LEFT JOIN users u ON u.id=r.submitted_by
    WHERE r.project_id=$1 AND r.status='submitted'
      AND r.week_start >= (SELECT date_trunc('week',enabled_at AT TIME ZONE 'Asia/Shanghai')::date
        FROM project_weekly_report_settings WHERE id=1)
      AND ${weekHasWorkdaySql('r.week_start')}
    ORDER BY r.week_start,r.id`, [projectId]);
}

const escape = (v: any) => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderClosureWeeklyReports(rows: any[] | undefined, embedded = false) {
  if (!rows) return ''; // Historical snapshots are never silently filled with live data.
  const content = (value: any) => {
    const text = String(value || '').trim() || '未填写';
    return embedded && text.length > 120
      ? `<details><summary>${escape(text.slice(0,120))}… 展开</summary><p class="weekly-text">${escape(text)}</p></details>`
      : `<p class="weekly-text">${escape(text)}</p>`;
  };
  return `<h3 class="sub-title" id="weekly-summary">负责人周报总结</h3>${!rows.length?'<p class="note">暂无已提交的负责人周报。</p>':`<div class="tbl-wrap"><table class="tbl weekly-table"><thead><tr><th>周期</th><th>周报负责人</th><th>项目状态</th><th>本周成果</th><th>问题及处理</th></tr></thead><tbody>${rows.map(r=>{
    const status = ({normal:['正常推进','#217c60'],risk:['存在风险','#a66b00'],blocked:['已受阻','#c53746']} as any)[r.overall_status] || ['未填写','#667'];
    let avatar='';
    try { const url=new URL(r.owner_avatar_url); if(['https:','http:'].includes(url.protocol)) avatar=`<img src="${escape(url.href)}" alt="" width="24" height="24" style="border-radius:50%;vertical-align:middle;margin-right:6px">`; } catch {}
    const period=`${escape(r.week_start)}<br>至 ${escape(r.week_end)}`;
    const href=`/daily-report?tab=weekly&amp;projectId=${encodeURIComponent(r.project_id)}&amp;weekStart=${encodeURIComponent(r.week_start)}`;
    return `<tr><td>${embedded?`<a href="${href}" target="_blank" rel="noopener noreferrer">${period}</a>`:period}</td><td>${avatar}${escape(r.owner_name)}</td><td style="color:${status[1]};font-weight:600">${status[0]}</td><td>${content(r.achievements)}</td><td>${content(r.risks)}</td></tr>`;
  }).join('')}</tbody></table></div>`}`;
}

export const closureWeeklyStyle = `.weekly-table{min-width:760px}.weekly-table th:nth-child(1){width:17%}.weekly-table th:nth-child(2){width:14%}.weekly-table th:nth-child(3){width:12%}.weekly-table th:nth-child(4){width:30%}.weekly-table td{vertical-align:top}.weekly-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;line-height:1.7}.weekly-table details{padding:0;border:0;margin:0}.weekly-table summary{font-weight:400}`;
