export interface WeeklyNotice {
  id: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  weekStart: string;
  weekEnd: string;
  desktopPath: string;
  mobilePath: string;
}

// Keep one task row while retaining every missing week and the original execution status.
export function mergeWeeklyTodos(groups: any[], notices: WeeklyNotice[]): any[] {
  const result = groups.map(g => ({ ...g, tasks: g.tasks.map((t: any) => ({ ...t, weeklyNotices: [] as WeeklyNotice[] })) }));
  const projects = new Map(result.map(g => [String(g.projectId), g]));
  const seen = new Set<string>();
  for (const notice of notices) {
    const key = `${notice.projectId}:${notice.taskId}:${notice.weekStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let group = projects.get(String(notice.projectId));
    if (!group) {
      group = { projectId: notice.projectId, name: notice.projectName, tasks: [] };
      projects.set(String(notice.projectId), group);
      result.push(group);
    }
    let task = group.tasks.find((t: any) => String(t.id) === String(notice.taskId));
    if (!task) {
      task = { id: notice.taskId, title: notice.taskTitle, weeklyOnly: true, weeklyNotices: [] };
      group.tasks.push(task);
    }
    task.weeklyNotices.push(notice);
  }
  for (const group of result) {
    for (const task of group.tasks) task.weeklyNotices.sort((a: WeeklyNotice, b: WeeklyNotice) => a.weekStart.localeCompare(b.weekStart));
  }
  return result;
}
