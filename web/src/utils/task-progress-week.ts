const DAY = 86_400_000;
function parseDay(value?: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
const monday = (time: number) => time - ((new Date(time).getUTCDay() + 6) % 7) * DAY;
const dateText = (time: number) => new Date(time).toISOString().slice(0, 10);

export function taskProgressWeek(plannedStart?: string | null, workDate?: string | null, plannedDue?: string | null) {
  const start = parseDay(plannedStart);
  const selected = parseDay(workDate);
  const due = parseDay(plannedDue);
  const empty = (label: string) => ({ number: null, label, range: '' });
  if (selected == null) return empty('请选择工作日期');
  if (start == null) return empty('未设置计划开始日期');
  if (selected < start) return empty('计划开始前');
  if (due != null && selected > due) return empty('任务截止后');
  const selectedMonday = monday(selected);
  const number = Math.round((selectedMonday - monday(start)) / (7 * DAY)) + 1;
  return {
    number, label: `任务第 ${number} 周`,
    range: `${dateText(Math.max(start, selectedMonday))} 至 ${dateText(Math.min(due ?? Infinity, selectedMonday + 6 * DAY))}`,
  };
}
