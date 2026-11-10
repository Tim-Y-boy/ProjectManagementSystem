import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { config } from '../../config/config';
import { FeishuNotifyService } from '../feishu/feishu-notify.service';
import { ProjectWeeklyReportsService } from '../project-weekly-reports/project-weekly-reports.service';
import { addDays, beijingDate } from './weekly-progress.rules';
import { weeklyReportReminderCard } from './weekly-report-reminder-card';
import { weeklyReminderDate } from '../holidays/work-calendar';

@Injectable()
export class WeeklyReportReminderService {
  private readonly logger = new Logger(WeeklyReportReminderService.name);
  constructor(private readonly db: DataSource, private readonly reports: ProjectWeeklyReportsService,
    private readonly notify: FeishuNotifyService) {}

  @Cron('0 0 16 * * *', { timeZone: 'Asia/Shanghai' })
  async scheduled() {
    try { await this.dispatch(); }
    catch (error) { this.logger.error('项目周报群催交发送失败', error instanceof Error ? error.stack : String(error)); }
  }

  async dispatch(now = new Date()) {
    const date = beijingDate(now);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const week = addDays(date, -((day + 6) % 7));
    const calendarRows = await this.db.query('SELECT date::text, kind FROM holidays');
    const holidays = new Map<string, string>(calendarRows.map((row: any) => [row.date, row.kind]));
    if (weeklyReminderDate(week, holidays) !== date) return;
    const base = String(process.env.WEB_FRONT_URL || process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
    if (!base || !config.feishu.weeklyProgressGroupTargets.length) return;
    const runner = this.db.createQueryRunner();
    await runner.connect();
    let locked = false;
    try {
      const [lock] = await runner.query('SELECT pg_try_advisory_lock(781260, 31) AS locked');
      locked = lock.locked;
      if (!locked) return;
      const rows = (await this.reports.notificationRows(now)).filter(row => row.weekStart === week);
      const message = weeklyReportReminderCard(rows, week, addDays(week, 6), `${base}/daily-report?tab=weekly&weekStart=${week}`);
      if (!message.count) return;
      for (const target of new Set(config.feishu.weeklyProgressGroupTargets)) {
        const [sent] = await runner.query(`SELECT id FROM notifications WHERE type='weekly_report_group_reminder'
          AND target=$1 AND success=true AND sent_at >= $2::timestamptz AND sent_at < $3::timestamptz LIMIT 1`,
        [target, `${week}T00:00:00+08:00`, `${addDays(week, 7)}T00:00:00+08:00`]);
        if (!sent) await this.notify.sendGroupCard('weekly_report_group_reminder', target, message.card, message.fallback);
      }
    } finally {
      try { if (locked) await runner.query('SELECT pg_advisory_unlock(781260, 31)'); }
      finally { await runner.release(); }
    }
  }
}
