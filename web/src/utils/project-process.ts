/** Include the selected task and all descendants, deduplicating records by ID. */
export function collectTaskProcess(task: any, updates: any[], assets: any[]) {
  const ids = new Set<string>();
  const visit = (node: any) => {
    if (!node || ids.has(String(node.id))) return;
    ids.add(String(node.id));
    for (const child of node.children || []) visit(child);
  };
  visit(task);
  const unique = (rows: any[]) => [...new Map(rows.filter(row => ids.has(String(row.taskId))).map(row => [String(row.id), row])).values()];
  return { updates: unique(updates), assets: unique(assets) };
}
