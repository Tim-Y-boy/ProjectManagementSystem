// 项目多负责人（ownerIds 数组）前端唯一判定源。
// 后端返回一律带 ownerIds:number[]；老数据/旧接口可能只有 ownerId 单值，这里兜底。
// 比较统一 String()（bigint id 跨端可能类型不一致）。

/** 取项目的负责人 id 数组：ownerIds 优先，ownerId 兜底 */
export const projectOwnerIds = (p: any): number[] => {
  if (p == null) return [];
  if (Array.isArray(p?.ownerIds)) return p.ownerIds.map(Number);
  if (p?.ownerId != null) return [Number(p.ownerId)];
  return [];
};

/** uid 是否为该项目任一负责人 */
export const isOwnerOf = (p: any, uid?: number | string | null): boolean =>
  uid != null && projectOwnerIds(p).some((id) => String(id) === String(uid));

/** 列表与详情共用结项入口条件；任务统计均排除已取消任务，提交时后端再次校验。 */
export const canApplyProjectClosure = (p: any, uid?: number | string | null, isAdmin = false): boolean =>
  !!p && (isAdmin || isOwnerOf(p, uid)) && p.status === 'active' && !!p.planLocked &&
  (!p.closureState || p.closureState === 'none') &&
  Number(p.taskCount) > 0 && Number(p.doneCount) === Number(p.taskCount);

/** 负责人展示文本：单值→「姓名」；多值→「甲、乙 等N人」（最多展开 max 个） */
export const ownerLabel = (
  p: any,
  nameOf: (id: number) => string,
  max = 3,
): string => {
  const ids = projectOwnerIds(p);
  if (!ids.length) return '未指定负责人';
  if (ids.length === 1) return nameOf(ids[0]) || String(ids[0]);
  const shown = ids.slice(0, max).map((id) => nameOf(id) || String(id)).join('、');
  return ids.length > max ? `${shown} 等${ids.length}人` : shown;
};
