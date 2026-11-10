export type InboxCategory = 'approve' | 'accept' | 'todo' | 'inform' | 'owned' | 'future';
export type InboxFilter = 'all' | InboxCategory;
export interface InboxItem {
  key: string; category: InboxCategory; title: string; project: string; projectId?: string | number; description: string;
  action: string; path: string; mobilePath?: string; date?: string; startAt?: string; dueAt?: string; identity?: string; assignees?: string; taskId?: number;
  approvalType?: 'change' | 'accept' | 'confirm' | 'closure' | 'reopen' | 'termination' | 'weekly-amendment';
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
  return ['all', 'approve', 'accept', 'todo', 'inform', 'owned'].includes(String(value)) ? String(value) as InboxFilter : 'all';
}
export function currentInboxRows(rows: InboxItem[]): InboxItem[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (row.done || row.category === 'future') return false;
    const key = row.identity || row.key;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export function inboxCounts(rows: InboxItem[]) {
  const counts = { all: currentInboxRows(rows).length, approve: 0, accept: 0, todo: 0, inform: 0, owned: 0, future: 0 };
  for (const row of rows) if (!row.done) counts[row.category]++;
  return counts;
}
export function beijingToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function taskStartLabel(startAt?: string, today = beijingToday()): string {
  if (!startAt) return '未排期';
  const days = Math.round((Date.parse(startAt) - Date.parse(today)) / 86400000);
  return days > 0 ? (days <= 5 ? `即将开始 · 还有 ${days} 天` : `未开始 · 距开始还有 ${days} 天`) : '待开始';
}
function executionCategory(t: any, today: string): InboxCategory {
  if (t.status !== 'todo' || t.inboxRisk || t.weeklyNotices?.length) return 'todo';
  return !t.startAt || (Date.parse(t.startAt) - Date.parse(today)) / 86400000 > 5 ? 'future' : 'todo';
}
export function approvalDetailPath(path: string): string {
  return path.replace(/^\/(?:plan-changes)(?=\?|$)/, '/approvals').replace(/^\/(?:closures|closure-reports)(?=\?request=)/, '/approvals');
}
// Weekly reminders have already been merged by task; each actionable task counts once.
export function buildInbox(data: any, groups: any[], notices: any[], ready: any[], today = beijingToday()): InboxItem[] {
  const rows: InboxItem[] = [];
  for (const report of data.projectWeeklyReports || []) if (report.status !== 'submitted' && report.canEdit !== false) {
    const key = `project-weekly-${report.projectId}-${report.weekStart}`;
    const query = `tab=weekly&projectId=${encodeURIComponent(report.projectId)}&weekStart=${encodeURIComponent(report.weekStart)}`;
    rows.push({ key, identity: key, category: 'owned', title: report.status === 'draft' ? '项目周报待提交' : '项目周报待填写', project: report.projectName, projectId: report.projectId,
      description: `汇报周期：${report.weekStart} 至 ${report.weekEnd}`,
      action: '填写周报', path: report.desktopPath || `/daily-report?${query}`, mobilePath: report.mobilePath || `/mobile/daily-report?${query}`,
      date: report.weekStart, status: report.overdue ? '周报逾期未提交' : report.status === 'draft' ? '周报待提交' : '周报待填写' });
  }
  for (const request of data.weeklyAmendments || []) {
    const query = `tab=weekly&projectId=${request.projectId}&weekStart=${request.weekStart}`;
    rows.push({key:`weekly-amendment-${request.id}`,category:'approve',approvalType:'weekly-amendment',title:'周报修改申请',project:request.projectName,projectId:request.projectId,description:`${request.weekStart} · ${request.reason}`,date:request.createdAt,action:'查看并审批',path:`/daily-report?${query}`,mobilePath:`/mobile/daily-report?${query}`});
  }
  for (const request of data.terminations || []) if (request.status === 'pending' && request.canReview) {
    rows.push({ key: `termination-${request.id}`, category: 'approve', approvalType: 'termination', title: '项目终止申请', project: request.projectName, projectId: request.projectId, description: request.reason, date: request.createdAt, action: '查看并审批', path: `/approvals?tab=termination&terminationId=${request.id}`, mobilePath: `/mobile/approve?tab=termination&terminationId=${request.id}` });
  }
  for (const g of data.confirm || []) for (const t of g.tasks) rows.push({ key: `confirm-${t.id}`, identity: `task-${t.id}`, startAt: t.startAt, status: t.status, category: 'approve', approvalType: 'confirm', title: t.title, project: g.name, projectId: g.projectId, description: '新任务确认', action: '去确认', path: `/approvals?confirmId=${t.id}`, mobilePath: `/mobile/approve?confirmId=${t.id}`, dueAt: t.dueAt });
  for (const c of data.pendingApprovals || []) rows.push({ key: `change-${c.id}`, category: 'approve', title: `${c.itemCount || 0} 项计划变更`, project: c.projectName, projectId: c.projectId, description: c.reason || '查看变更内容后审批', action: '查看并审批', path: `/approvals?changeId=${c.id}`, mobilePath: `/mobile/approve?changeId=${c.id}`, date: c.createdAt });
  for (const [category, list] of [['accept', data.accept || []], ['todo', groups], ['owned', data.ownedTasks || []]] as const) {
    for (const g of list) for (const t of g.tasks) rows.push({ key: `${category === 'todo' ? 'task' : category}-${t.id}`, category: category === 'accept' ? 'approve' : category === 'owned' ? 'owned' : executionCategory(t, today), identity: `task-${t.id}`, startAt: t.startAt, assignees: t.assignees, taskId: category === 'accept' ? Number(t.id) : undefined, title: t.title, project: g.name, projectId: g.projectId, description: category === 'accept' ? '任务验收 · 展开查看进展与资料后审批' : '', action: category === 'accept' ? '去审批' : t.weeklyNotices?.length ? '补填进展' : '处理任务', path: `/tasks?focusProject=${g.projectId}&taskId=${t.id}`, mobilePath: `/mobile/task/${t.id}`, dueAt: t.dueAt, status: t.status, risk: t.inboxRisk || 0, weeklyNotices: t.weeklyNotices });
  }
  for (const p of ready) if (p.state !== 'pending') rows.push({ key: `ready-${p.projectId}`, category: 'todo', title: '申请项目结项', project: p.name, projectId: p.projectId, description: `全部任务已验收，完成后已等待 ${p.waitingDays || 0} 天`, action: '申请结项', path: `/closures?projectId=${p.projectId}`, dueAt: p.plannedEnd });
  for (const n of notices) {
    const approval = ['closure_review', 'closure_peer_review', 'reopen_review'].includes(n.kind);
    const p = n.payload || {};
    rows.push({ key: `notice-${n.id}`, category: approval ? 'approve' : 'inform', title: p.title || '项目通知', project: n.project_name || p.projectName || p.supplement?.projectName || '', projectId: n.project_id, description: p.text || '', date: n.created_at, done: !!n.acknowledged_at, noticeId: Number(n.id), warning: p.revokedAt ? `此标记已由 ${p.revokedBy || '操作人'} 撤销，请以当前记录为准。` : undefined, action: n.kind === 'supplement_notice' ? '查看任务进展' : p.label || '查看详情', mobilePath: p.mobilePath, path: n.kind === 'supplement_notice' ? `/tasks?focusProject=${n.project_id}&taskId=${p.taskId}` : p.path || '/closures', acknowledge: !approval && !n.acknowledged_at ? n.kind === 'closure_hr' ? '确认已阅' : '我已知晓' : undefined });
  }
  const managedRisks = new Map(rows.filter(r => r.category === 'owned').map(r => [r.identity, r.risk]));
  const missingWeeks = new Map<string, Map<string, any>>();
  for (const row of rows) if (row.identity && row.weeklyNotices?.length) {
    const weeks = missingWeeks.get(row.identity) || new Map<string, any>();
    for (const notice of row.weeklyNotices) weeks.set(notice.weekStart, notice);
    missingWeeks.set(row.identity, weeks);
  }
  for (const row of rows) if (row.identity) {
    row.risk = Math.max(row.risk || 0, managedRisks.get(row.identity) || 0);
    if (missingWeeks.has(row.identity)) row.weeklyNotices = [...missingWeeks.get(row.identity)!.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  }
  const order = { approve: 0, accept: 1, todo: 2, inform: 3, owned: 4, future: 5 };
  for (const row of rows) if (row.category === 'approve') {
    row.path = approvalDetailPath(row.path);
    if (row.path.startsWith('/approvals')) row.mobilePath = row.path.replace('/approvals', '/mobile/approve');
  }
  for (const row of rows) if (row.category === 'approve' && !row.approvalType) row.approvalType = row.key.startsWith('change-') ? 'change' : row.taskId ? 'accept' : notices.find(n => `notice-${n.id}` === row.key)?.kind === 'reopen_review' ? 'reopen' : 'closure';
  return rows.sort((a, b) => Number(!!a.done) - Number(!!b.done) || order[a.category] - order[b.category] || (b.risk || 0) - (a.risk || 0) || String(a.dueAt || a.date || '9999').localeCompare(String(b.dueAt || b.date || '9999')));
}
