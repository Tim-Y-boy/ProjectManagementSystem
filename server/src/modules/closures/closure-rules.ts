import { BadRequestException } from '@nestjs/common';

export const beijingDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
export const dateDiff = (later: string, earlier: string) => Math.round((Date.parse(later) - Date.parse(earlier)) / 86400000);

export function taskEvidence(tasks: any[]) {
  return JSON.stringify([...tasks].sort((a, b) => Number(a.id) - Number(b.id)).map((t) => ({
    id: String(t.id), parent: t.parent_id == null ? null : String(t.parent_id), title: t.title,
    description: t.description, status: t.status, start: t.start_at, due: t.due_at, sort: t.sort_order,
    completed: t.completed_at ? new Date(t.completed_at).toISOString() : null,
    participants: (t.participants || []).map((p: any) => `${p.role}:${p.userId}`).sort(),
  })));
}

export function completionFacts(tasks: any[], plannedEnd: string | null, now = new Date()) {
  const active = tasks.filter((t) => t.status !== 'cancelled');
  const parents = new Set(active.filter((t) => t.parent_id != null).map((t) => String(t.parent_id)));
  const leaves = active.filter((t) => !parents.has(String(t.id)));
  const unfinished = active.filter((t) => t.status !== 'done');
  const missingTime = leaves.some((t) => !t.completed_at || !Number.isFinite(new Date(t.completed_at).getTime()));
  const ready = leaves.length > 0 && unfinished.length === 0 && !missingTime;
  const completedAt = ready ? new Date(Math.max(...leaves.map((t) => new Date(t.completed_at).getTime()))).toISOString() : null;
  const today = beijingDate(now);
  const completedDate = completedAt ? beijingDate(new Date(completedAt)) : null;
  if (completedDate && completedDate > today) throw new BadRequestException('任务验收时间晚于当前日期，请核实数据');
  return {
    ready, leafCount: leaves.length, unfinished: unfinished.map((t) => ({ id: t.id, title: t.title, status: t.status })),
    missingTime, completedAt, completedDate, plannedEnd, today,
    waitingDays: completedDate ? Math.max(0, dateDiff(today, completedDate)) : 0,
    lateDays: plannedEnd && completedDate ? Math.max(0, dateDiff(completedDate, plannedEnd)) : null,
    requestOverdueDays: plannedEnd ? Math.max(0, dateDiff(today, plannedEnd)) : null,
  };
}

export function validateClosure(facts: ReturnType<typeof completionFacts>, body: any) {
  if (!facts.ready) throw new BadRequestException('须全部有效任务验收完成且验收时间完整，才能申请结项');
  if (!facts.plannedEnd) throw new BadRequestException('项目缺少批准的截止日期，无法申请结项');
  const delayReason = String(body?.delayReason ?? '').trim();
  const overdueReason = String(body?.overdueReason ?? '').trim();
  if (delayReason.length > 4000 || overdueReason.length > 4000) throw new BadRequestException('原因不能超过4000字');
  return { delayReason, overdueReason };
}

// 只记录时间事实，申请滞后与审批等待分别展示，不要求负责人填写说明。
export function closureTimingAlerts(facts: {
  waitingDays?: number; requestOverdueDays?: number | null; completedAt?: string | null;
  plannedEnd?: string | null; closedAt?: string; approvalWaitingDays?: number;
}): string[] {
  const alerts: string[] = [];
  if (facts.waitingDays >= 3) alerts.push(`全部任务验收完成后 ${facts.waitingDays} 天才申请结项。`);
  if (facts.requestOverdueDays > 0) alerts.push(`申请结项时已超过批准截止日期 ${facts.requestOverdueDays} 天。`);
  if (facts.closedAt) {
    const closedDate = beijingDate(new Date(facts.closedAt));
    if (facts.completedAt) {
      const gap = dateDiff(closedDate, beijingDate(new Date(facts.completedAt)));
      if (gap >= 3) alerts.push(`全部任务验收完成至结项生效相隔 ${gap} 天（申请前 ${facts.waitingDays ?? '未知'} 天，审批等待 ${facts.approvalWaitingDays ?? '未知'} 天）。`);
    }
    if (facts.plannedEnd) {
      const late = dateDiff(closedDate, facts.plannedEnd);
      if (late > 0) alerts.push(`结项生效时已超过批准截止日期 ${late} 天。`);
    }
  }
  return alerts;
}

export function validateSupplement(workDate: string, dueAt: string | null) {
  if (!dueAt) throw new BadRequestException('任务未设置截止日期，不能标记合理补填');
  if (workDate > dueAt) throw new BadRequestException('工作日期超过任务截止日期，不能标记合理补填');
}
