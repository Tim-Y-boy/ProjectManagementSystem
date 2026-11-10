import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProjectWeeklyReportsService } from '../project-weekly-reports/project-weekly-reports.service';
import { weekHasWorkdaySql } from '../holidays/work-calendar';

const md = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_\[\]])/g, '\\$1');
export function appendWeeklySection(card: Record<string, any>, heading: string, lines: string[]) {
  if (!lines.length) return;
  const elements = card.body?.elements || card.elements;
  elements.push({ tag: 'hr' }, card.schema === '2.0'
    ? { tag: 'markdown', content: `**${heading}**\n${lines.join('\n')}` }
    : { tag: 'div', text: { tag: 'lark_md', content: `**${heading}**\n${lines.join('\n')}` } });
}
export function weeklyReminderLines(rows: any[], url: (path: string) => string | null) {
  return rows.map(row => `${md(row.projectName)} · ${row.weekStart} 至 ${row.weekEnd} · ${row.overdue ? '周报逾期未提交' : '周报待提交（周一09:00截止）'}${url(row.desktopPath) ? ` [填写周报](${url(row.desktopPath)})` : ''}`);
}
export function weeklyLeaderLines(summary: any, url: (path: string) => string | null) {
  const link = (row: any) => url(row.desktopPath) ? `[查看周报](${url(row.desktopPath)})` : '';
  return [`周报周期：${summary.weekStart} 至 ${summary.weekEnd}\n**共 ${summary.total} 个项目　已提交 ${summary.submittedCount} 份　未提交 ${summary.missingCount} 份**`,
    '**已提交周报**\n' + (summary.highlights.length ? summary.highlights.map((row: any, index: number) =>
      `${index + 1}. ${md(row.projectName)} · ${md(row.ownerName)}　${link(row)}`).join('\n') : '暂无'),
    '**未提交周报**\n' + (summary.missing.length ? summary.missing.map((row: any, index: number) =>
      `${index + 1}. ${md(row.projectName)} · ${md(row.ownerName)}`).join('\n') : '暂无')];
}

export function appendWeeklyLeaderSummary(card: Record<string, any>, lines: string[], url: string | null) {
  const elements = card.body?.elements || card.elements;
  const markdown = (content: string) => card.schema === '2.0'
    ? { tag: 'markdown', content } : { tag: 'div', text: { tag: 'lark_md', content } };
  elements.push({ tag: 'hr' }, markdown('**项目周报汇总**'));
  for (const line of lines) elements.push(markdown(line));
  if (url) elements.push(markdown(`[查看全部项目周报](${url})`));
}

/** Serializes delivery and stores only successful weekly attachments; no independent leader message. */
@Injectable()
export class ProjectWeeklyNotificationsService {
  constructor(private readonly db: DataSource, private readonly reports: ProjectWeeklyReportsService) {}

  async reminderRows(now = new Date(), beforeDeadline = false) {
    const rows = await this.reports.notificationRows(now);
    return rows.filter(row => row.status !== 'submitted' && (beforeDeadline
      ? !row.overdue && new Date(row.dueAt).getTime() - now.getTime() > 0 && new Date(row.dueAt).getTime() - now.getTime() <= 3600000
      : row.overdue));
  }

  async withLeaderSummary<T extends { sent?: boolean }>(now: Date, deliver: (summary: any | null) => Promise<T>): Promise<T | { skipped: string }> {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    let locked = false;
    try {
      const [lock] = await runner.query('SELECT pg_try_advisory_lock(781260, 30) AS locked');
      locked = lock.locked;
      if (!locked) return { skipped: 'already_running' };
      // Persist obligations after downtime before selecting unsent closed working weeks.
      // A holiday or unavailable sender must not make older summaries disappear next Monday.
      await this.reports.collect(now);
      const pending = await runner.query(`SELECT to_char(r.week_start,'YYYY-MM-DD') AS week_start
        FROM project_weekly_reports r CROSS JOIN project_weekly_report_settings settings
        WHERE settings.id=1 AND ${weekHasWorkdaySql('r.week_start')}
          AND r.week_start >= date_trunc('week',settings.enabled_at AT TIME ZONE 'Asia/Shanghai')::date
          AND ((r.week_start + 7)::timestamp + interval '9 hours') AT TIME ZONE 'Asia/Shanghai' <= $1::timestamptz
          AND NOT EXISTS (SELECT 1 FROM project_weekly_notification_deliveries d
            WHERE d.kind='leader' AND d.week_start=r.week_start)
        GROUP BY r.week_start ORDER BY r.week_start`, [now]);
      const summaries = [];
      for (const row of pending) {
        const summary = await this.reports.summaryForLeader(row.week_start);
        if (summary?.total) summaries.push(summary);
      }
      // One daily card carries every outstanding working week's summary after a holiday.
      const result = await deliver(summaries.length ? { ...summaries[0], summaries } : null);
      if (result.sent) for (const summary of summaries) {
        await runner.query(`INSERT INTO project_weekly_notification_deliveries(kind,week_start) VALUES('leader',$1) ON CONFLICT DO NOTHING`, [summary.weekStart]);
      }
      return result;
    } finally {
      try { if (locked) await runner.query('SELECT pg_advisory_unlock(781260, 30)'); }
      finally { await runner.release(); }
    }
  }

  async serializedDigest<T>(slot: string, action: () => Promise<T>): Promise<T | null> {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    let locked = false;
    try {
      const [lock] = await runner.query('SELECT pg_try_advisory_lock(781261, hashtext($1)) AS locked', [slot]);
      locked = lock.locked;
      return locked ? await action() : null;
    } finally {
      try { if (locked) await runner.query('SELECT pg_advisory_unlock(781261, hashtext($1))', [slot]); }
      finally { await runner.release(); }
    }
  }
}
