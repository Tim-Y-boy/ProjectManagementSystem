type ProjectTask = { id: number | string; parentId?: number | string | null; status: string; dueAt?: string | null };

// Both overview and project filters use effective leaves, never stored parent deadlines.
export function projectHealth(tasks: ProjectTask[], today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) {
  const active = tasks.filter(t => t.status !== 'cancelled');
  const parents = new Set(active.filter(t => t.parentId != null).map(t => String(t.parentId)));
  const leaves = active.filter(t => !parents.has(String(t.id)));
  const dueLimit = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10);
  let riskLevel = 0;
  for (const t of leaves) {
    if (t.status === 'done' || !t.dueAt) continue;
    if (t.dueAt < today) riskLevel = 2;
    else if (t.dueAt <= dueLimit) riskLevel = Math.max(riskLevel, 1);
  }
  return { riskLevel, allTasksDone: leaves.length > 0 && leaves.every(t => t.status === 'done') };
}
