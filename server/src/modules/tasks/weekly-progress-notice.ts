/** Build a display tree from missing leaves and their real ancestors, grouped by project ID. */
export interface WeeklyNoticeLeaf {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  ownerNames: string[];
  assigneeNames: string[];
  desktopPath: string;
}
interface TaskNode {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  sort_order: number;
}
interface Owner {
  project_id: string;
  id: string;
  name: string;
  feishu_user_id: string | null;
}
interface DisplayNode {
  task: TaskNode;
  row?: WeeklyNoticeLeaf;
  children: Map<string, DisplayNode>;
}

export function weeklyNoticeProjects(rows: WeeklyNoticeLeaf[], tasks: TaskNode[], owners: Owner[]) {
  const taskMap = new Map(tasks.map(task => [String(task.id), task]));
  const projects = new Map<string, { name: string; rows: WeeklyNoticeLeaf[] }>();
  for (const row of rows) {
    const id = String(row.projectId);
    if (!projects.has(id)) projects.set(id, { name: row.projectName, rows: [] });
    projects.get(id)!.rows.push(row);
  }
  return [...projects].map(([id, project], projectIndex) => {
    const roots = new Map<string, DisplayNode>();
    for (const row of project.rows) {
      const leaf = taskMap.get(String(row.taskId)) || {
        id: row.taskId, project_id: id, parent_id: null, title: row.taskTitle, sort_order: 0,
      };
      const path = [leaf];
      const visited = new Set([String(leaf.id)]);
      let parentId = leaf.parent_id;
      while (parentId != null && !visited.has(String(parentId))) {
        const parent = taskMap.get(String(parentId));
        if (!parent || String(parent.project_id) !== id) break;
        visited.add(String(parent.id));
        path.unshift(parent);
        parentId = parent.parent_id;
      }
      let siblings = roots;
      for (const task of path) {
        const taskId = String(task.id);
        if (!siblings.has(taskId)) siblings.set(taskId, { task, children: new Map() });
        const node = siblings.get(taskId)!;
        if (taskId === String(row.taskId)) node.row = row;
        siblings = node.children;
      }
    }
    const entries: Array<{ title: string; number: string; depth: number; row?: WeeklyNoticeLeaf }> = [];
    const walk = (siblings: Map<string, DisplayNode>, prefix: string, depth: number) => {
      const ordered = [...siblings.values()].sort((a, b) =>
        (a.task.sort_order || 0) - (b.task.sort_order || 0)
        || String(a.task.id).localeCompare(String(b.task.id), 'en', { numeric: true }));
      ordered.forEach((node, index) => {
        const number = `${prefix}.${index + 1}`;
        entries.push({ title: node.task.title, number, depth, row: node.row });
        walk(node.children, number, depth + 1);
      });
    };
    walk(roots, String(projectIndex + 1), 1);
    const people = [...new Map(owners.filter(owner => String(owner.project_id) === id)
      .map(owner => [String(owner.id), owner])).values()];
    return { id, name: project.name, number: projectIndex + 1, count: project.rows.length,
      ownerNames: people.length ? people.map(owner => owner.name) : project.rows[0].ownerNames,
      owners: people, entries };
  });
}
