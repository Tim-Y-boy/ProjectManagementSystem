import type { WeeklyReport } from '../api/project-weekly-reports';

export function weeklyMonday(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime())) return '';
  value.setUTCDate(value.getUTCDate() - (value.getUTCDay() + 6) % 7);
  return value.toISOString().slice(0, 10);
}
export function currentWeeklyMonday() {
  return weeklyMonday(new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
}
export function weeklyPriority(row: WeeklyReport) {
  return row.overallStatus === 'blocked' ? 0 : row.overallStatus === 'risk' ? 1 : row.coordination?.trim() ? 2 : 3;
}
