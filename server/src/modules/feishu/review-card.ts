import { Notification } from '../../entities/notification.entity';

export const REVIEW_NOTIFICATION_TYPES = ['plan_change_submitted', 'plan_change_owner_approved', 'task_submitted_acceptance', 'closure_review', 'closure_peer_review', 'reopen_review'];
export type ReviewResult = { label: string; color: string; at?: Date | string; reviewer?: string };
const outcome = (status: string, at?: Date | string, reviewer?: string): ReviewResult | null => {
  if (['approved', 'done', 'voided'].includes(status)) return { label: '已审核 · 已通过', color: 'green', at, reviewer };
  if (['rejected', 'doing'].includes(status)) return { label: '已审核 · 已退回', color: 'red', at, reviewer };
  if (['cancelled', 'withdrawn'].includes(status)) return { label: '已撤回', color: 'grey', at, reviewer };
  return null;
};

// 只读业务结果；任务按通知所属的那一轮验收日志判定，避免重新提交覆盖旧卡片。
export async function resolveReviewResult(n: Notification, query: (sql: string, args: any[]) => Promise<any[]>): Promise<ReviewResult | null> {
  if (n.type === 'closure_peer_review' && n.response?.reviewRef?.noticeId) {
    const [row] = await query(`SELECT c.status,c.reviewed_at,c.snapshot,n.payload FROM closure_notices n JOIN project_closures c ON c.id::text=n.payload->>'closureId' WHERE n.id=$1 AND n.project_id=$2`,[n.response.reviewRef.noticeId,n.projectId]);
    if (!row) return null;
    const w=row.snapshot.workflow, uid=Number(row.payload.reviewerId);
    const event=w.events.slice(Number(row.payload.eventIndex||0)).find(e=>(e.type==='transfer'&&Number(e.from)===uid)||Number(e.userId)===uid);
    if(event?.type==='transfer')return {label:'已转交 · '+event.toName,color:'grey',at:event.at,reviewer:event.fromName};
    if(event)return outcome(event.type,event.at,event.name);
    return row.status==='pending'?null:{label:'本次审核已结束',color:'grey',at:row.reviewed_at};
  }
  if (n.type.startsWith('plan_change_') && n.planChangeId) {
    const [r] = await query('SELECT c.*,u.name AS reviewer_name,o.name AS owner_name FROM plan_changes c LEFT JOIN users u ON u.id=c.approver_id LEFT JOIN users o ON o.id=c.owner_approver_id WHERE c.id=$1', [n.planChangeId]);
    if (!r) return null;
    const ownerStage = n.type !== 'plan_change_owner_approved' && (n.response?.reviewRef?.stage === 'owner' ||
      (!n.response?.reviewRef?.stage && r.owner_approved_at && new Date(n.createdAt) <= new Date(r.owner_approved_at)));
    if (ownerStage && r.owner_approved_at) return { label: '已审核 · 已转终审', color: 'green', at: r.owner_approved_at, reviewer: r.owner_name };
    return outcome(r.status, r.reviewed_at, r.reviewer_name);
  }
  if (n.type === 'task_submitted_acceptance' && n.taskId) {
    const [r] = await query("SELECT l.to_status,l.created_at,u.name AS reviewer_name FROM task_logs l LEFT JOIN users u ON u.id=l.operator_id WHERE l.task_id=$1 AND l.from_status='pending_accept' AND l.to_status IN ('done','doing','rejected','cancelled') AND l.created_at >= $2 ORDER BY l.created_at ASC,l.id ASC LIMIT 1", [n.taskId, n.createdAt]);
    return r ? outcome(r.to_status, r.created_at, r.reviewer_name) : null;
  }
  if (['closure_review', 'reopen_review'].includes(n.type)) {
    const id = n.response?.reviewRef?.noticeId;
    if (id) {
      const table = n.type === 'closure_review' ? 'project_closures' : 'closure_reopens';
      const prefix = n.type === 'closure_review' ? 'closure' : 'reopen';
      const [r] = await query('SELECT r.status,r.reviewed_at,u.name AS reviewer_name FROM closure_notices n JOIN '+table+" r ON n.event_key='"+prefix+":'||r.id||':review' LEFT JOIN users u ON u.id=r.approver_id WHERE n.id=$1 AND n.project_id=$2", [id, n.projectId]);
      return r ? outcome(r.status, r.reviewed_at, r.reviewer_name) : null;
    }
    // 旧结项通知仅在正文带有明确申请编号时回写；不按项目猜测最新申请。
    const legacy = n.type === 'closure_review' && n.content.match(/[?&]request=(\d+)/);
    if (legacy) {
      const [r] = await query('SELECT c.status,c.reviewed_at,u.name AS reviewer_name FROM project_closures c LEFT JOIN users u ON u.id=c.approver_id WHERE c.id=$1 AND c.project_id=$2', [legacy[1], n.projectId]);
      return r ? outcome(r.status, r.reviewed_at, r.reviewer_name) : null;
    }
  }
  return null;
}

export function reviewedCard(n: Notification, result: ReviewResult): Record<string, any> {
  const card = n.response?.reviewCard ? JSON.parse(JSON.stringify(n.response.reviewCard)) : {
    header: { title: {tag: 'plain_text', content: '审核通知'} },
    elements: [{tag: 'div', text: {tag: 'plain_text', content: n.content}}],
  };
  if (!n.response?.reviewCard) {
    const base = (process.env.WEB_FRONT_URL || process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    const request = n.content.match(/[?&]request=(\d+)/)?.[1];
    const path = n.planChangeId ? '/approvals?changeId='+n.planChangeId : n.taskId ? '/approvals?'+(n.type==='task_pending_confirm'?'confirmId=':'taskId=')+n.taskId : request ? '/approvals?request='+request : '/my-todo';
    if (base) card.elements.push({tag:'action',actions:[{tag:'button',text:{tag:'plain_text',content:'查看结果'},type:'default',url:base+path}]});
  }
  card.config = { ...card.config, wide_screen_mode: true, update_multi: true };
  card.header = { ...card.header, template: result.color, title: {tag: 'plain_text', content: result.label} };
  const at = result.at ? new Date(result.at) : null;
  const detail = [result.label, result.reviewer ? '审核人：'+result.reviewer : '',
    at && Number.isFinite(at.getTime()) ? '处理时间：'+at.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : ''].filter(Boolean).join('\n');
  // 保留原申请的资料和跳转地址；按钮改为结果入口，不再暗示仍需审批。
  const updateActions = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.tag === 'note') node.elements = [{tag:'plain_text',content:result.label+'，可查看处理结果。'}];
    if (node.tag === 'button') {
      node.text = {tag:'plain_text',content:result.label+' · 查看结果'}; node.type='default';
      // 已处理事项不再留在待办中，结果入口必须指向原业务记录。
      const path = n.planChangeId ? '/approvals?changeId='+n.planChangeId
        : n.taskId ? '/approvals?'+(n.type==='task_pending_confirm'?'confirmId=':'taskId=')+n.taskId : n.response?.reviewRef?.resultPath || null;
      if (path && node.url) {
        try {
          const url = new URL(path.replace(/^\/(?:closures|closure-reports)(?=\?request=)/, '/approvals'), node.url);
          if (n.taskId && !n.planChangeId && result.at) url.searchParams.set('at', new Date(result.at).toISOString());
          node.url = url.href;
        } catch { /* 保留无法解析的历史链接 */ }
      }
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(updateActions); else if (value && typeof value==='object') updateActions(value);
  };
  updateActions(card);
  if (['closure_peer_review','closure_review'].includes(n.type)) {
    const projectName = n.content.match(/「([^]*?)」/)?.[1];
    const summary = `${projectName ? '「'+projectName+'」' : '该项目'}的${n.type==='closure_review'?'结项终审':'结项验收审核'}已有处理结果，可查看原申请及审核意见。`;
    const body = card.elements?.find((node:any)=>node.tag==='div'&&node.text?.tag==='plain_text');
    if(body) body.text.content=summary;
  }
  card.elements = [{ tag:'div', text:{tag:'plain_text',content:detail}}, {tag:'hr'}, ...(card.elements || [])];
  return card;
}
