export function dailyReportDate(value?: string, now = new Date()): string {
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const date = value || new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date || date > today) {
    throw new Error('请选择有效日期，不能晚于今天');
  }
  return date;
}
