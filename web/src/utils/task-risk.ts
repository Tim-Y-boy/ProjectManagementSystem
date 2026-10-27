// 任务风险/状态判定（任务管理页 + 项目总览共用）

// 今天（本地日期 YYYY-MM-DD）
export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 只有完成/取消退出风险判定；已退回仍未完成，继续按原截止日期计算。
export const isDoneLike = (s: string) => ['done', 'cancelled'].includes(s);

// 叶子任务风险：2=延期（已过截止）、1=临期（3 天内到期）、0=正常
export function leafRisk(t: { status: string; dueAt: string | null }): number {
  if (isDoneLike(t.status) || !t.dueAt) return 0;
  const today = todayStr();
  if (t.dueAt < today) return 2;
  const diff = (new Date(t.dueAt).getTime() - new Date(today).getTime()) / 86400000;
  return diff <= 3 ? 1 : 0;
}

// 距截止天数：正=还有 N 天，负=已延期 N 天；无截止日返回 null
export function riskDays(dueAt: string | null): number | null {
  if (!dueAt) return null;
  const today = todayStr();
  return Math.round((new Date(dueAt).getTime() - new Date(today).getTime()) / 86400000);
}

export interface CompletionTask {
  status?: string;
  dueAt?: string | null;
  completedAt?: string | null;
  hasChildren?: number | boolean;
  children?: Array<{ status?: string }>;
}

// 截止日期减验收日期：正数为提前、负数为延期；按北京时间的自然日计算。
// 父任务由子任务汇总，不用父级自动更新的时间冒充实际完成日期。
export function completionDays(task: CompletionTask | null | undefined): number | null {
  if (!task || task.status !== 'done' || task.hasChildren || task.children?.some((c) => c.status !== 'cancelled')) return null;
  if (!task.dueAt || !/^\d{4}-\d{2}-\d{2}$/.test(task.dueAt) || !task.completedAt) return null;
  const completed = new Date(task.completedAt);
  const due = Date.parse(`${task.dueAt}T00:00:00Z`);
  if (!Number.isFinite(completed.getTime()) || !Number.isFinite(due)) return null;
  if (new Date(due).toISOString().slice(0, 10) !== task.dueAt) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(completed);
  const date = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const day = Date.parse(`${date.year}-${date.month}-${date.day}T00:00:00Z`);
  return Math.round((due - day) / 86400000);
}
