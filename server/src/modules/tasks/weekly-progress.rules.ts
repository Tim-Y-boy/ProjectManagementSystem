const DAY = 86_400_000;
const BEIJING_OFFSET = 8 * 3_600_000;

export const beijingDate = (value: Date | string) =>
  new Date(new Date(value).getTime() + BEIJING_OFFSET).toISOString().slice(0, 10);
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((day + 6) % 7));
}
export function isWorkingDate(date: string, holidays: Map<string, string>): boolean {
  if (holidays.has(date)) return holidays.get(date) === 'makeup';
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day > 0 && day < 6;
}

export interface WeeklyTransition {
  created_at: Date | string;
  from_status: string | null;
  to_status: string | null;
}
export interface WeeklyTaskState {
  status: string;
  created_at: Date | string;
}

/** Reconstruct actual doing intervals; the activation instant bounds legacy history. */
export function doingIntervals(task: WeeklyTaskState, logs: WeeklyTransition[], enabledAt: Date | string, now: Date) {
  const lower = Math.max(new Date(enabledAt).getTime(), new Date(task.created_at).getTime());
  const upper = now.getTime();
  const transitions = logs.filter((log) => log.to_status && new Date(log.created_at).getTime() <= upper)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  let state = transitions[0]?.from_status ?? (transitions.length ? 'todo' : task.status);
  let cursor = lower;
  const intervals: Array<[number, number]> = [];
  for (const log of transitions) {
    const at = new Date(log.created_at).getTime();
    if (at <= lower) { state = log.to_status!; continue; }
    if (state === 'doing' && at > cursor) intervals.push([cursor, at]);
    cursor = at;
    state = log.to_status!;
  }
  if (state === 'doing' && upper > cursor) intervals.push([cursor, upper]);
  return intervals;
}

/** Friday 14:00 starts the current week's reminder window; older missing weeks remain visible.
 * Holiday suppression applies to outbound scheduling, not to reading outstanding work. */
export function requiredWeeks(
  task: WeeklyTaskState, logs: WeeklyTransition[], enabledAt: Date | string,
  now: Date, holidays: Map<string, string>, reminderOnly = true,
): string[] {
  const today = beijingDate(now);
  const currentWeek = weekStart(today);
  const intervals = doingIntervals(task, logs, enabledAt, now);
  const result: string[] = [];
  for (let week = weekStart(beijingDate(enabledAt)); week <= currentWeek; week = addDays(week, 7)) {
    const reminderAt = Date.parse(`${addDays(week, 4)}T14:00:00+08:00`);
    if (reminderOnly && now.getTime() < reminderAt) continue;
    let required = false;
    for (let day = week; day < addDays(week, 7); day = addDays(day, 1)) {
      if (!isWorkingDate(day, holidays)) continue;
      const start = Date.parse(`${day}T00:00:00+08:00`);
      if (intervals.some(([from, to]) => from < start + DAY && to > start)) { required = true; break; }
    }
    if (required) result.push(week);
  }
  return result;
}

export function progressSatisfiesWeek(update: { work_date: string; content: string }, week: string): boolean {
  return update.work_date >= week && update.work_date <= addDays(week, 6) && !!update.content?.trim();
}

/** Submission and reminders share actual execution weeks; submission does not wait for Friday. */
export function requiredAcceptanceWeeks(
  task: WeeklyTaskState, logs: WeeklyTransition[], enabledAt: Date | string,
  now: Date, holidays: Map<string, string>,
): Array<{ weekStart: string; weekEnd: string }> {
  return requiredWeeks(task, logs, enabledAt, now, holidays, false)
    .map(week => ({ weekStart: week, weekEnd: addDays(week, 6) }));
}
export function weeklyTaskPaths(taskId: string | number, projectId: string | number, week: string) {
  return {
    desktopPath: `/tasks?projectId=${projectId}&taskId=${taskId}&weekStart=${week}`,
    mobilePath: `/m/tasks/${taskId}?weekStart=${week}`,
  };
}
