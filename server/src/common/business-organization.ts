interface BusinessDepartment {
  id: string | number;
  feishuDeptId: string;
  parentFeishuId?: string | null;
  name?: string;
}

/** Selection policy only: does not alter sync, login, or read permissions. */
export function businessDepartmentIds(departments: BusinessDepartment[], env = process.env): Set<string> {
  const configured = (env.FEISHU_BUSINESS_ROOT_DEPT || env.FEISHU_SYNC_ROOT_DEPT || '').trim();
  const namedRoots = departments.filter(d => d.name === '示例业务公司');
  const root = configured && configured !== '0' ? configured : namedRoots.length === 1 ? namedRoots[0].feishuDeptId : '';
  if (!root) return new Set();
  const blockedRoots = new Set((env.FEISHU_READONLY_ROOT_DEPTS || '').split(',').map(s => s.trim()).filter(Boolean));
  const byId = new Map(departments.map(d => [d.feishuDeptId, d]));
  const result = new Set<string>();
  for (const department of departments) {
    let cursor: string | null | undefined = department.feishuDeptId;
    const visited = new Set<string>();
    let inside = false;
    let blocked = false;
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      if (blockedRoots.has(cursor)) blocked = true;
      if (cursor === root) inside = true;
      cursor = byId.get(cursor)?.parentFeishuId;
    }
    if (inside && !blocked) result.add(String(department.id));
  }
  return result;
}

export function businessPersonSelectable(person: { deptId?: string | number | null; readOnly?: boolean; isActive?: boolean }, departments: Set<string>): boolean {
  return !person.readOnly && person.isActive !== false && person.deptId != null && departments.has(String(person.deptId));
}
