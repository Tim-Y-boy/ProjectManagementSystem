import { BadRequestException } from '@nestjs/common';
const DAY = 86400000;
export function weekOf(now = new Date()): string {
  const local = new Date(now.getTime() + 8 * 3600000);
  local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  return local.toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}
export function weekWindow(week: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week || '') || !Number.isFinite(Date.parse(week)) ||
      new Date(week).toISOString().slice(0, 10) !== week || new Date(week).getUTCDay() !== 1) {
    throw new BadRequestException('周次必须为有效的周一日期');
  }
  return { weekEnd: addDays(week, 6), opensAt: new Date(`${week}T00:00:00+08:00`).toISOString(),
    dueAt: new Date(`${addDays(week, 7)}T09:00:00+08:00`).toISOString() };
}
