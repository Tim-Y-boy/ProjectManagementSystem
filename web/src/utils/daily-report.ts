export interface DailyReportItem {
  id: string | number;
  projectId: string | number;
  projectName: string;
  taskId: string | number;
  taskTitle: string;
  userId: string | number;
  userName: string | null;
  deptId: string | number | null;
  deptName: string | null;
  content: string;
  workDate: string;
  risk: string | null;
  affectDueDate: boolean;
  nextPlan: string | null;
  createdAt: string;
}
export interface DailyReport { date: string; items: DailyReportItem[] }

export function reportExcerpt(content: string, limit = 76) {
  const text = content.replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > limit ? characters.slice(0, limit).join('') + '…' : text;
}

export function groupDailyReport(items: DailyReportItem[]) {
  const projects = new Map<string, { id: string; name: string; items: DailyReportItem[] }>();
  for (const item of items) {
    const id = String(item.projectId);
    if (!projects.has(id)) projects.set(id, { id, name: item.projectName, items: [] });
    projects.get(id)!.items.push(item);
  }
  return [...projects.values()];
}
