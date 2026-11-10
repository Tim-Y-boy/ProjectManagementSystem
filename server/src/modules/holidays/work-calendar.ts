/** System calendar: explicit holiday/makeup overrides the normal Monday–Friday week. */
export function weekHasWorkdaySql(week: string): string {
  return `EXISTS (SELECT 1 FROM generate_series((${week})::date, (${week})::date + 6, interval '1 day') calendar_day
    LEFT JOIN holidays calendar_holiday ON calendar_holiday.date=calendar_day::date
    WHERE CASE WHEN calendar_holiday.kind IS NOT NULL THEN calendar_holiday.kind='makeup'
      ELSE EXTRACT(ISODOW FROM calendar_day) BETWEEN 1 AND 5 END)`;
}

export function weeklyReminderDate(week: string, holidays: Map<string, string>): string | null {
  const date = (offset: number) => new Date(Date.parse(`${week}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  const works = (offset: number) => holidays.has(date(offset)) ? holidays.get(date(offset)) === 'makeup' : offset < 5;
  // Keep the regular Friday slot; if Friday is off, use this week's last working day.
  if (works(4)) return date(4);
  for (let offset = 6; offset >= 0; offset--) if (works(offset)) return date(offset);
  return null;
}
