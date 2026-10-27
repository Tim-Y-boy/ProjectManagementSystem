export type InboxCategory = 'approve' | 'accept' | 'todo' | 'inform';
export type InboxFilter = 'all' | InboxCategory;
export interface InboxItem {
  key: string; category: InboxCategory; title: string; project: string; projectId?: string | number; description: string;
  action: string; path: string; mobilePath?: string; date?: string; dueAt?: string; taskId?: number;
  approvalType?: 'change' | 'accept' | 'confirm' | 'closure' | 'reopen';
  done?: boolean; noticeId?: number; acknowledge?: string; weeklyNotices?: any[]; risk?: number; status?: string; warning?: string;
}
export interface InboxProjectGroup { key: string; name: string; rows: InboxItem[]; overdue: number; weekly: number }
export function groupInboxProjects(rows: InboxItem[]): InboxProjectGroup[] {
  const groups = new Map<string, InboxProjectGroup>();
  for (const row of rows) {
    const key = row.projectId != null ? `project-${row.projectId}` : row.project ? `name-${row.project}` : 'other';
    if (!groups.has(key)) groups.set(key, { key, name: row.project || (row.projectId != null ? `项目 #${row.projectId}` : '其他事项'), rows: [], overdue: 0, weekly: 0 });
    const group = groups.get(key)!;
    group.rows.push(row);
    if (!row.done && row.risk === 2) group.overdue++;
    if (!row.done && row.weeklyNotices?.length) group.weekly++;
  }
  return [...groups.values()];
}
export function inboxFilter(value: unknown): InboxFilter {
  if (value === 'accept') return 'approve';
  return ['all', 'approve', 'accept', 'todo', 'inform'].includes(String(value)) ? String(value) as InboxFilter : 'all';
}
export function inboxCounts(rows: InboxItem[]) {
  const counts = { all: 0, approve: 0, accept: 0, todo: 0, inform: 0 };
  for (const row of rows) if (!row.done) { counts.all++; counts[row.category]++; }
  return counts;
}
export function approvalDetailPath(path: string): string {
  return path.replace(/^\/(?:plan-changes)(?=\?|$)/, '/approvals').replace(/^\/(?:closures|closure-reports)(?=\?request=)/, '/approvals');
}
// Weekly reminders have already been merged by task; each actionable task counts once.
export function buildInbox(data: any, groups: any[], notices: any[], ready: any[]): InboxItem[] {
  const rows: InboxItem[] = [];
  for (const g of data.confirm || []) for (const t of g.tasks) rows.push({ key: `confirm-${t.id}`, category: 'approve', approvalType: 'confirm', title: t.title, project: g.name, projectId: g.projectId, description: '新任务确认', action: '去确认', path: `/approvals?confirmId=${t.id}`, mobilePath: `/mobile/approve?confirmId=${t.id}`, dueAt: t.dueAt });
  for (const c of data.pendingApprovals || []) rows.push({ key: `change-${c.id}`, category: 'approve', title: `${c.itemCount || 0} 项计划变更`, project: c.projectName, projectId: c.projectId, description: c.reason || '查看变更内容后审批', action: '查看并审批', path: `/approvals?changeId=${c.id}`, mobilePath: `/mobile/approve?changeId=${c.id}`, date: c.createdAt });
  for (const [category, list] of [['accept', data.accept || []], ['todo', groups]] as const) {
    for (const g of list) for (const t of g.tasks) rows.push({ key: `${category === 'todo' ? 'task' : 'accept'}-${t.id}`, category: category === 'accept' ? 'approve' : category, taskId: category === 'accept' ? Number(t.id) : undefined, title: t.title, project: g.name, projectId: g.projectId, description: category === 'accept' ? '任务验收 · 展开查看进展与资料后审批' : '', action: category === 'accept' ? '去审批' : t.weeklyNotices?.length ? '补填进展' : '处理任务', path: `/tasks?focusProject=${g.projectId}&taskId=${t.id}`, mobilePath: `/mobile/task/${t.id}`, dueAt: t.dueAt, status: t.status, risk: t.inboxRisk || 0, weeklyNotices: t.weeklyNotices });
  }
  for (const p of ready) if (p.state !== 'pending') rows.push({ key: `ready-${p.projectId}`, category: 'todo', title: '申请项目结项', project: p.name, projectId: p.projectId, description: `全部任务已验收，完成后已等待 ${p.waitingDays || 0} 天`, action: '申请结项', path: `/closures?projectId=${p.projectId}`, dueAt: p.plannedEnd });
  for (const n of notices) {
    const approval = ['closure_review', 'closure_peer_review', 'reopen_review'].includes(n.kind);
    const p = n.payload || {};
    rows.push({ key: `notice-${n.id}`, category: approval ? 'approve' : 'inform', title: p.title || '项目通知', project: n.project_name || p.projectName || p.supplement?.projectName || '', projectId: n.project_id, description: p.text || '', date: n.created_at, done: !!n.acknowledged_at, noticeId: Number(n.id), warning: p.revokedAt ? `此标记已由 ${p.revokedBy || '操作人'} 撤销，请以当前记录为准。` : undefined, action: n.kind === 'supplement_notice' ? '查看任务进展' : p.label || '查看详情', path: n.kind === 'supplement_notice' ? `/tasks?focusProject=${n.project_id}&taskId=${p.taskId}` : p.path || '/closures', acknowledge: !approval && !n.acknowledged_at ? n.kind === 'closure_hr' ? '确认已阅' : '我已知晓' : undefined });
  }
  const order = { approve: 0, accept: 1, todo: 2, inform: 3 };
  for (const row of rows) if (row.category === 'approve') {
    row.path = approvalDetailPath(row.path);
    if (row.path.startsWith('/approvals')) row.mobilePath = row.path.replace('/approvals', '/mobile/approve');
  }
  for (const row of rows) if (row.category === 'approve' && !row.approvalType) row.approvalType = row.key.startsWith('change-') ? 'change' : row.taskId ? 'accept' : notices.find(n => `notice-${n.id}` === row.key)?.kind === 'reopen_review' ? 'reopen' : 'closure';
  return rows.sort((a, b) => Number(!!a.done) - Number(!!b.done) || order[a.category] - order[b.category] || (b.risk || 0) - (a.risk || 0) || String(a.dueAt || a.date || '9999').localeCompare(String(b.dueAt || b.date || '9999')));
}
