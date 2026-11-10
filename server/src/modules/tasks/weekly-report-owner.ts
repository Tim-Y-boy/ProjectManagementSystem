import { BadRequestException } from '@nestjs/common';

export function resolveWeeklyReportOwner(ownerIds: number[], requested: unknown, current?: number | null): number | null {
  const ids = [...new Set(ownerIds.map(Number))];
  const supplied = requested !== undefined;
  if (!ids.length) {
    if (supplied && requested != null) throw new BadRequestException('周报负责人必须是项目负责人');
    return null;
  }
  if (ids.length === 1 && !supplied) return ids[0];
  const selected = supplied ? Number(requested) : Number(current);
  if (!Number.isSafeInteger(selected) || !ids.includes(selected)) {
    throw new BadRequestException(ids.length === 1 ? '周报负责人必须是唯一的项目负责人' : '请从项目负责人中选择周报负责人');
  }
  return selected;
}
