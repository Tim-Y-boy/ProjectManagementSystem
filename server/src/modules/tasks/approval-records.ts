// These fragments use the authenticated user parameter ($1); never accept user-supplied SQL.
export const projectOwnerSql = `(p.owner_id=$1 OR EXISTS (SELECT 1 FROM project_owners po WHERE po.project_id=p.id AND po.user_id=$1))`;
export const taskParticipantSql = (alias = 't') => `(${alias}.creator_id=$1 OR ${alias}.assignee_id=$1 OR ${alias}.acceptor_id=$1 OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id=${alias}.id AND ta.user_id=$1))`;
export const projectParticipantSql = `(${projectOwnerSql} OR EXISTS (SELECT 1 FROM tasks pt WHERE pt.project_id=p.id AND ${taskParticipantSql('pt')}))`;
// Cancelled tasks remain relevant. Snapshots preserve access for people reassigned by a change.
export const changeRelatedSql = `(c.requester_id=$1 OR c.approver_id=$1 OR c.owner_approver_id=$1 OR c.final_approver_id=$1 OR ${projectOwnerSql} OR EXISTS (
  SELECT 1 FROM plan_change_items ci LEFT JOIN tasks t ON t.id=ci.task_id WHERE ci.change_id=c.id AND (
    ${taskParticipantSql()} OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(
        COALESCE(ci.before->'assigneeIds','[]'::jsonb) || COALESCE(ci.after->'assigneeIds','[]'::jsonb) ||
        COALESCE(ci.before->'acceptorIds','[]'::jsonb) || COALESCE(ci.after->'acceptorIds','[]'::jsonb)
      ) person(id) WHERE person.id=$1::text
    )
  )
))`;

export interface ApprovalLog {
  id: number; taskId: number; action: string; fromStatus: string | null; toStatus: string | null;
  createdAt: Date; operatorId: number; operatorName?: string; payload: Record<string, any> | null;
}
export function approvalKind(log: ApprovalLog): 'confirm' | 'accept' | null {
  if (log.fromStatus === 'pending_confirm' || (log.action === 'create' && log.payload?.status === 'pending_confirm')) return 'confirm';
  if (log.toStatus === 'pending_accept' || log.fromStatus === 'pending_accept') return 'accept';
  return null;
}
export function approvalCycle(logs: ApprovalLog[], anchorId: number) {
  const sorted = [...logs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || Number(a.id) - Number(b.id));
  const anchorIndex = sorted.findIndex(l => String(l.id) === String(anchorId));
  const anchor = sorted[anchorIndex];
  const kind = anchor && (approvalKind(anchor) || (anchor.action === 'create' && sorted.some(l => l.fromStatus === 'pending_confirm') ? 'confirm' : null));
  if (!kind) return null;
  const pending = kind === 'confirm' ? 'pending_confirm' : 'pending_accept';
  const submission = (l: ApprovalLog) => kind === 'confirm' ? l.action === 'create' && (l.payload?.status === pending || sorted.some(event => event.fromStatus === pending)) : l.toStatus === pending;
  let start = anchorIndex;
  while (start > 0 && !submission(sorted[start])) start--;
  // Old data may lack its submission; do not attach a different cycle or unrelated log.
  if (!submission(sorted[start])) start = anchorIndex;
  let end = start + 1;
  while (end < sorted.length && !submission(sorted[end]) && sorted[end].fromStatus !== pending) end++;
  const submitted = submission(sorted[start]) ? sorted[start] : null;
  const decision = !submitted && anchor.fromStatus === pending ? anchor : end < sorted.length && sorted[end].fromStatus === pending ? sorted[end] : null;
  const status = decision ? (decision.toStatus === 'done' || (kind === 'confirm' && decision.toStatus === 'todo') ? 'approved' : decision.toStatus === 'doing' || decision.toStatus === 'rejected' ? 'rejected' : 'cancelled') : end < sorted.length ? 'unknown' : 'pending';
  return { kind, status, submitted, decision, events: [submitted, decision].filter((l): l is ApprovalLog => !!l) };
}
