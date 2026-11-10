// 父任务日期派生：叶子取自身日期；父级（有 children）取所有后代叶子的 最早开始 / 最晚结束
export function deriveTaskRange(t: any): { startAt: string | null; dueAt: string | null } {
  if (!t?.children?.length) return { startAt: t?.startAt ?? null, dueAt: t?.dueAt ?? null };
  let start: string | null = null;
  let due: string | null = null;
  for (const c of t.children) {
    const r = deriveTaskRange(c);
    if (r.startAt && (!start || r.startAt < start)) start = r.startAt;
    if (r.dueAt && (!due || r.dueAt > due)) due = r.dueAt;
  }
  return { startAt: start, dueAt: due };
}

// 递归：对树中每个父节点用派生日期覆盖（叶子不变），便于下游直接用 task.startAt/dueAt
export function annotateDerivedDates(t: any): any {
  if (!t) return t;
  if (t.children?.length) {
    for (const c of t.children) annotateDerivedDates(c);
    const r = deriveTaskRange(t);
    t.startAt = r.startAt;
    t.dueAt = r.dueAt;
  }
  return t;
}
