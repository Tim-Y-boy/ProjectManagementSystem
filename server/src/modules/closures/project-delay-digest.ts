export interface DelayDigestTask {
  projectId: number; projectName: string; projectOwners: string;
  title: string; owners: string; assignees: string; days: number;
}
const escape = (s: string) => String(s || '未设置').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]!)).replace(/[\\`*_\[\]]/g, '\\$&');
export function buildProjectDelayDigest(rows: DelayDigestTask[], date: string, test = false) {
  const chunks: DelayDigestTask[][] = [];
  for(let i=0;i<rows.length;i+=12) chunks.push(rows.slice(i,i+12));
  if(!chunks.length) chunks.push([]);
  return chunks.map((chunk,index) => {
    const text = [`${test ? '【测试数据，仅供预览】\n' : ''}${date} · 共 ${new Set(rows.map(r=>r.projectId)).size} 个项目、${rows.length} 项延期任务${chunks.length>1?` · 第 ${index+1}/${chunks.length} 条`:''}`];
    const elements: any[] = [{tag:'div',text:{tag:'lark_md',content:text[0]}}];
    let projectId: number | undefined;
    for(const row of chunk) {
      if(projectId !== row.projectId) {
        projectId=row.projectId;
        elements.push({tag:'hr'},{tag:'div',text:{tag:'lark_md',content:`**${escape(row.projectName)}**\n项目负责人：${escape(row.projectOwners)}`}});
        text.push(`${row.projectName}｜项目负责人：${row.projectOwners}`);
      }
      const content=`　　${escape(row.title)}\n　　负责人：${escape(row.owners)}　执行人：${escape(row.assignees)}\n　　<font color='red'>延期 **${row.days} 天**</font>`;
      elements.push({tag:'note',elements:[{tag:'lark_md',content}]});
      text.push(`${row.title}｜负责人：${row.owners}｜执行人：${row.assignees}｜延期 ${row.days} 天`);
    }
    if(!chunk.length) {elements.push({tag:'div',text:{tag:'plain_text',content:'今日暂无未完成的延期任务。'}});text.push('今日暂无未完成的延期任务。');}
    elements.push({tag:'note',elements:[{tag:'plain_text',content:'口径：未完成、未取消的末级任务；按当前截止日期计算自然日延期天数。'}]});
    return {card:{config:{wide_screen_mode:true},header:{template:'red',title:{tag:'plain_text',content:'项目延期日报'}},elements},fallback:`项目延期日报\n${text.join('\n')}`};
  });
}

export const DELAY_DIGEST_SQL = `SELECT p.id AS "projectId",p.name AS "projectName",t.title,
  ($1::date-t.due_at::date)::int AS days,
  COALESCE((SELECT string_agg(u.name,'、' ORDER BY u.id) FROM users u WHERE u.id=p.owner_id OR EXISTS(SELECT 1 FROM project_owners o WHERE o.project_id=p.id AND o.user_id=u.id)),'未设置') AS "projectOwners",
  COALESCE((SELECT string_agg(u.name,'、' ORDER BY u.id) FROM users u WHERE u.id=t.acceptor_id OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.role='acceptor' AND a.user_id=u.id)),'未设置') AS owners,
  COALESCE((SELECT string_agg(u.name,'、' ORDER BY u.id) FROM users u WHERE u.id=t.assignee_id OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.role='assignee' AND a.user_id=u.id)),'未设置') AS assignees
  FROM tasks t JOIN projects p ON p.id=t.project_id
  WHERE p.status='active' AND COALESCE(p.closure_state,'none')<>'closed'
    AND t.status NOT IN ('done','cancelled') AND t.due_at::date<$1::date
    AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=t.id AND child.status<>'cancelled')
  ORDER BY p.id,days DESC,t.id`;
