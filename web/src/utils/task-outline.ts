/** Number the sorted tree before display-only filtering, independently per project. */
export function numberTaskTree(roots: any[]): void {
  const counts = new Map<string, number>();
  const visit = (node: any, number: string) => {
    node.outlineNumber = number;
    (node.children || []).forEach((child: any, index: number) => visit(child, `${number}.${index + 1}`));
  };
  for (const root of roots) {
    const project = String(root.projectId);
    const index = (counts.get(project) || 0) + 1;
    counts.set(project, index);
    visit(root, String(index));
  }
}
