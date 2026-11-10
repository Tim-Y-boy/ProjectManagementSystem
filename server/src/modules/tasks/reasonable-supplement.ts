type SupplementRecord = { workDate?: string | null; createdAt?: Date | string | null };

function validDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// 使用真实提交时间 createdAt，而非填写的工作日期或最后编辑时间。
// 返回空字符串表示可以确认；否则直接作为按钮下方的禁用说明。
export function reasonableSupplementDisabledReason(dueAt: string | null | undefined, update: SupplementRecord): string {
  if (!validDate(dueAt)) return '任务未设置有效截止日期，无法确认合理补填';
  if (!validDate(update.workDate)) return '关键进展缺少有效工作日期，无法确认合理补填';
  if (update.workDate > dueAt) return '工作日期已超过任务截止日期，不能确认为合理补填。';
  const submitted = update.createdAt ? new Date(update.createdAt) : null;
  if (!submitted || !Number.isFinite(submitted.getTime())) return '关键进展缺少有效提交时间，无法确认合理补填';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(submitted);
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const submittedDate = `${date.year}-${date.month}-${date.day}`;
  if (submittedDate <= dueAt) return '未超过任务截止日期，无需确认合理补填';
  return '';
}
