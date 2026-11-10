import { buildNotifyCard, NotifyBlock } from '../feishu/notify-card';

type ReportRow = { projectId: string | number; projectName: string; userId: string | number; userName?: string; content: string; workDate: string };
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_[\]])/g, '\\$1');
const excerpt = (text: string) => {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.slice(0, 76).join('') + (chars.length > 76 ? '…' : '');
};

export function dailyReportCard(report: { date: string; items: ReportRow[] }, url: string | null, isYesterday: boolean) {
  const groups = new Map<string, NotifyBlock>();
  const shown = report.items.slice(0, 30);
  for (const row of shown) {
    const key = String(row.projectId);
    if (!groups.has(key)) groups.set(key, { color: 'blue', title: `📁 ${escape(row.projectName)}`, tasks: [] });
    const backfill = row.workDate < report.date ? ` <font color='grey'>（补填 ${escape(row.workDate)}）</font>` : '';
    groups.get(key)!.tasks.push({ title: `**${escape(row.userName || '未知人员')}**　${escape(excerpt(row.content))}${backfill}` });
  }
  const empty = isYesterday ? '昨天暂无任何进展' : `${report.date} 暂无任何进展`;
  const totalProjects = new Set(report.items.map(row => String(row.projectId))).size;
  const card = buildNotifyCard({
    title: '工作日报',
    template: 'blue',
    fields: [{ label: '提交日期', value: report.date }, ...(report.items.length ? [{ label: '进展', value: `${report.items.length} 条` }, { label: '项目', value: `${totalProjects} 个` }] : [])],
    blocks: [...groups.values()],
    sections: report.items.length ? [] : [{ title: empty, lines: [] }],
    moreText: report.items.length > shown.length ? `另有 ${report.items.length - shown.length} 条进展，点击查看日报。` : undefined,
    action: { label: '查看工作日报', url },
  });
  const fallback = `【工作日报】提交日期：${report.date}\n${report.items.length
    ? shown.map(row => `${row.projectName} · ${row.userName || '未知人员'}：${excerpt(row.content)}${row.workDate < report.date ? `（补填 ${row.workDate}）` : ''}`).join('\n')
    : empty}${report.items.length > shown.length ? `\n另有 ${report.items.length - shown.length} 条进展` : ''}${url ? `\n${url}` : ''}`;
  return { card, fallback };
}
