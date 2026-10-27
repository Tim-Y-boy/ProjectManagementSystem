import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { config } from '../../config/config';
import { FeishuNotifyService } from '../feishu/feishu-notify.service';
import { buildNotifyCard } from '../feishu/notify-card';
import { weeklyNoticeProjects } from './weekly-progress-notice';
import { weeklyProgressCard } from './weekly-progress-card';
import {
  addDays, beijingDate, isWorkingDate, progressSatisfiesWeek, requiredWeeks, requiredAcceptanceWeeks, weeklyTaskPaths,
} from './weekly-progress.rules';

export interface WeeklyProgressNotice {
  id: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  weekStart: string;
  weekEnd: string;
  assigneeNames: string[];
  ownerNames: string[];
  desktopPath: string;
  mobilePath: string;
}
type MissingRow = WeeklyProgressNotice & { assigneeIds: string[] };
const md = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_\[\]()~])/g, '\\$1');

@Injectable()
export class WeeklyProgressService {
  private readonly logger = new Logger(WeeklyProgressService.name);
  constructor(private readonly db: DataSource, private readonly notify: FeishuNotifyService) {}

  /** Read source records, not the reminder cache: acceptance cannot depend on Cron having run. */
  async missingWeeksForTask(taskId: number, now = new Date()): Promise<{ weekStart: string; weekEnd: string }[]> {
    const manager = this.db.manager;
    const [settings] = await manager.query(`SELECT enabled_at FROM weekly_progress_settings WHERE id=1`);
    if (!settings || new Date(settings.enabled_at) > now) return [];
    const [task] = await manager.query(`SELECT t.status, t.start_at::text, t.due_at::text, t.created_at, p.status AS project_status,
      p.closure_state, p.plan_locked, EXISTS(SELECT 1 FROM tasks child
        WHERE child.parent_id=t.id AND child.status <> 'cancelled') AS has_children
      FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1`, [taskId]);
    if (!task || task.status === 'cancelled' || task.has_children || task.project_status !== 'active'
      || task.closure_state !== 'none' || !task.plan_locked) return [];
    const [logs, updates, holidays] = await Promise.all([
      manager.query(`SELECT from_status, to_status, created_at FROM task_logs
        WHERE task_id=$1 AND to_status IS NOT NULL ORDER BY created_at, id`, [taskId]),
      manager.query(`SELECT work_date::text, content FROM task_daily_updates WHERE task_id=$1`, [taskId]),
      this.holidayMap(manager),
    ]);
    return requiredAcceptanceWeeks(task, logs, settings.enabled_at, now, holidays)
      .filter(week => !updates.some((update: any) => update.work_date >= week.weekStart
        && update.work_date <= week.weekEnd && !!update.content?.trim()));
  }

  async listForUser(userId: number): Promise<{ items: WeeklyProgressNotice[]; total: number }> {
    // Also collect on read: downtime or a delayed Cron must not hide overdue work.
    await this.collect();
    const rows = await this.missingRows(this.db.manager, userId);
    const items = rows.map(({ assigneeIds: _ids, ...row }) => row);
    return { items, total: items.length };
  }

  @Cron('0 0 14 * * 5', { timeZone: 'Asia/Shanghai' })
  async scheduledCheck(): Promise<void> {
    try {
      const now = new Date();
      const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
      if (beijing.getUTCDay() !== 5 || beijing.getUTCHours() !== 14 || beijing.getUTCMinutes() !== 0) return;
      const holidays = await this.holidayMap(this.db.manager);
      if (!isWorkingDate(beijingDate(now), holidays)) return;
      await this.collect(now);
      await this.dispatch();
    } catch (error) {
      this.logger.error('周关键进展提醒失败，将在下次周五提醒时重试', error instanceof Error ? error.stack : String(error));
    }
  }

  private async holidayMap(manager: EntityManager): Promise<Map<string, string>> {
    const rows = await manager.query(`SELECT date::text, kind FROM holidays`);
    return new Map(rows.map((row: any) => [row.date, row.kind]));
  }

  async collect(now = new Date()): Promise<void> {
    await this.db.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(781260, 1)`);
      const [settings] = await manager.query(`SELECT enabled_at FROM weekly_progress_settings WHERE id=1`);
      if (!settings || new Date(settings.enabled_at) > now) return;
      const holidays = await this.holidayMap(manager);
      // Rebuild outstanding reminders from source history; obsolete weeks must not linger.
      await manager.query(`UPDATE weekly_progress_checks SET status='suppressed',
        suppression_reason='重新计算后不再需要提醒',last_checked_at=$1 WHERE status='missing'`, [now]);
      // Keep the audit row when a task becomes ineligible; it simply stops prompting.
      await manager.query(`UPDATE weekly_progress_checks w SET status='suppressed',
        suppression_reason='任务取消、转为父任务或项目未定稿/已归档/结项冻结', last_checked_at=$1
        WHERE NOT EXISTS (SELECT 1 FROM tasks t JOIN projects p ON p.id=t.project_id
          WHERE t.id=w.task_id AND t.status <> 'cancelled' AND p.status='active'
            AND p.closure_state='none' AND p.plan_locked=true
            AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=t.id AND child.status <> 'cancelled'))`, [now]);
      const tasks = await manager.query(`SELECT t.id::text, t.project_id::text, t.status, t.created_at
        FROM tasks t JOIN projects p ON p.id=t.project_id
        WHERE t.status <> 'cancelled' AND p.status='active' AND p.closure_state='none' AND p.plan_locked=true
          AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=t.id AND child.status <> 'cancelled')`);
      if (!tasks.length) return;
      const ids = tasks.map((task: any) => task.id);
      const logs = await manager.query(`SELECT task_id::text, from_status, to_status, created_at
        FROM task_logs WHERE task_id=ANY($1::bigint[]) AND to_status IS NOT NULL
        ORDER BY created_at, id`, [ids]);
      const updates = await manager.query(`SELECT id::text, task_id::text, work_date::text, content, created_at
        FROM task_daily_updates WHERE task_id=ANY($1::bigint[])
          AND work_date >= date_trunc('week', $2::timestamptz AT TIME ZONE 'Asia/Shanghai')::date
        ORDER BY created_at, id`, [ids, settings.enabled_at]);
      const logsByTask = new Map<string, any[]>();
      const updatesByTask = new Map<string, any[]>();
      for (const row of logs) { const bucket = logsByTask.get(row.task_id) || []; bucket.push(row); logsByTask.set(row.task_id, bucket); }
      for (const row of updates) { const bucket = updatesByTask.get(row.task_id) || []; bucket.push(row); updatesByTask.set(row.task_id, bucket); }
      for (const task of tasks) {
        const weeks = requiredWeeks(task, logsByTask.get(task.id) || [], settings.enabled_at, now, holidays);
        for (const week of weeks) {
          // Any valid author satisfies the task/week, regardless of current assignee changes.
          const progress = (updatesByTask.get(task.id) || []).find((update) => progressSatisfiesWeek(update, week));
          const late = progress ? beijingDate(progress.created_at) > addDays(week, 6) : false;
          await manager.query(`INSERT INTO weekly_progress_checks
            (task_id,project_id,week_start,week_end,status,first_checked_at,last_checked_at,
             resolved_at,resolved_update_id,submitted_at,is_late)
            VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)
            ON CONFLICT(task_id,week_start) DO UPDATE SET
              status=EXCLUDED.status,last_checked_at=EXCLUDED.last_checked_at,
              resolved_at=CASE WHEN EXCLUDED.status='resolved' THEN COALESCE(weekly_progress_checks.resolved_at,EXCLUDED.resolved_at) ELSE NULL END,
              resolved_update_id=EXCLUDED.resolved_update_id,submitted_at=EXCLUDED.submitted_at,
              is_late=EXCLUDED.is_late,suppression_reason=NULL`,
          [task.id, task.project_id, week, addDays(week, 6), progress ? 'resolved' : 'missing', now,
            progress ? now : null, progress?.id || null, progress?.created_at || null, late]);
        }
      }
    });
  }

  private async missingRows(manager: EntityManager, userId?: number): Promise<MissingRow[]> {
    const rows = await manager.query(`SELECT w.id::text, t.id::text AS task_id,t.title AS task_title,
      p.id::text AS project_id,p.name AS project_name,w.week_start::text,w.week_end::text,
      ARRAY(SELECT u.id::text FROM users u WHERE u.id=t.assignee_id OR EXISTS
        (SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.role='assignee' AND a.user_id=u.id) ORDER BY u.id) AS assignee_ids,
      ARRAY(SELECT u.name FROM users u WHERE u.id=t.assignee_id OR EXISTS
        (SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.role='assignee' AND a.user_id=u.id) ORDER BY u.id) AS assignee_names,
      ARRAY(SELECT u.name FROM users u WHERE u.id=p.owner_id OR EXISTS
        (SELECT 1 FROM project_owners o WHERE o.project_id=p.id AND o.user_id=u.id) ORDER BY u.id) AS owner_names
      FROM weekly_progress_checks w JOIN tasks t ON t.id=w.task_id JOIN projects p ON p.id=t.project_id
      WHERE w.status='missing' AND t.status IN ('doing','done') AND p.status='active' AND p.closure_state='none' AND p.plan_locked=true
        AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=t.id AND child.status <> 'cancelled')
        AND ($1::bigint IS NULL OR t.assignee_id=$1 OR EXISTS
          (SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.role='assignee' AND a.user_id=$1))
        AND NOT EXISTS(SELECT 1 FROM task_daily_updates d WHERE d.task_id=t.id
          AND d.work_date BETWEEN w.week_start AND w.week_end AND btrim(d.content) <> '')
      ORDER BY w.week_start DESC,p.id,t.id`, [userId ?? null]);
    return rows.map((row: any) => ({
      id: row.id, taskId: row.task_id, taskTitle: row.task_title,
      projectId: row.project_id, projectName: row.project_name,
      weekStart: row.week_start, weekEnd: row.week_end,
      assigneeIds: row.assignee_ids, assigneeNames: row.assignee_names, ownerNames: row.owner_names,
      ...weeklyTaskPaths(row.task_id, row.project_id, row.week_start),
    }));
  }

  private absoluteUrl(path: string): string | null {
    const base = (process.env.WEB_FRONT_URL || process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
    return base ? `${base}${path}` : null;
  }

  /** A separate session lock serializes outbound delivery without blocking dashboard collection. */
  async dispatch(): Promise<void> {
    const runner = this.db.createQueryRunner();
    await runner.connect();
    let locked = false;
    try {
      const [lock] = await runner.query(`SELECT pg_try_advisory_lock(781260, 2) AS locked`);
      locked = lock.locked;
      if (!locked) return;
      const rows = await this.missingRows(runner.manager);
      const batches = new Map<string, { channel: 'personal' | 'group'; target: string; week: string; rows: MissingRow[] }>();
      const append = (channel: 'personal' | 'group', target: string, row: MissingRow) => {
        const key = `${channel}:${target}:${row.weekStart}`;
        const batch = batches.get(key) || { channel, target, week: row.weekStart, rows: [] };
        batch.rows.push(row); batches.set(key, batch);
      };
      for (const row of rows) {
        for (const id of row.assigneeIds) append('personal', id, row);
        if (config.feishu.briefGroupChatId) append('group', config.feishu.briefGroupChatId, row);
      }
      for (const batch of batches.values()) {
        const [sent] = await runner.query(`SELECT sent_check_ids FROM weekly_progress_deliveries WHERE channel=$1 AND target=$2 AND week_start=$3`,
          [batch.channel, batch.target, batch.week]);
        const deliveredIds = new Set((sent?.sent_check_ids || []).map(String));
        batch.rows = batch.rows.filter((row) => !deliveredIds.has(String(row.id)));
        if (!batch.rows.length) continue;
        await runner.query(`INSERT INTO weekly_progress_deliveries(channel,target,week_start,attempts,attempted_at)
          VALUES($1,$2,$3,1,now()) ON CONFLICT(channel,target,week_start) DO UPDATE
          SET attempts=weekly_progress_deliveries.attempts+1,attempted_at=now()`, [batch.channel, batch.target, batch.week]);
        try {
          const result = await this.sendBatch(batch);
          await runner.query(`UPDATE weekly_progress_deliveries SET success=$4,
            sent_at=CASE WHEN $4 THEN now() ELSE NULL END,last_error=$5
            ,sent_check_ids=CASE WHEN $4 THEN ARRAY(SELECT DISTINCT unnest(sent_check_ids || $6::bigint[])) ELSE sent_check_ids END
            WHERE channel=$1 AND target=$2 AND week_start=$3`,
          [batch.channel, batch.target, batch.week, result.success, result.success ? null : JSON.stringify(result.response || '发送失败'), batch.rows.map(row => row.id)]);
        } catch (error) {
          await runner.query(`UPDATE weekly_progress_deliveries SET last_error=$4 WHERE channel=$1 AND target=$2 AND week_start=$3`,
            [batch.channel, batch.target, batch.week, error instanceof Error ? error.message : String(error)]);
        }
      }
    } finally {
      try {
        if (locked) await runner.query(`SELECT pg_advisory_unlock(781260, 2)`);
      } finally {
        await runner.release();
      }
    }
  }

  private async sendBatch(batch: { channel: 'personal' | 'group'; target: string; week: string; rows: MissingRow[] }) {
    const title = '周关键进展待补填';
    const range = `${batch.week} 至 ${addDays(batch.week, 6)}`;
    const projectIds = [...new Set(batch.rows.map(row => row.projectId))];
    const [tasks, owners] = await Promise.all([
      this.db.manager.query(`SELECT id::text, project_id::text, parent_id::text, title, sort_order
        FROM tasks WHERE project_id=ANY($1::bigint[])`, [projectIds]),
      this.db.manager.query(`SELECT p.id::text AS project_id,u.id::text,u.name,u.feishu_user_id
        FROM projects p JOIN users u ON u.id=p.owner_id OR EXISTS
          (SELECT 1 FROM project_owners o WHERE o.project_id=p.id AND o.user_id=u.id)
        WHERE p.id=ANY($1::bigint[]) ORDER BY p.id,u.id`, [projectIds]),
    ]);
    const projects = weeklyNoticeProjects(batch.rows, tasks, owners);
    const note = '请任一执行人补填对应周的关键进展，已补填的任务将自动从待补填列表移除。';
    const fallback = [`${title}（${range}）`, ...projects.flatMap(project => [
      '', `${project.number}. ${project.name}（${project.count} 项待补填）`,
      `项目负责人：${project.ownerNames.join('、') || '未设置'}`,
      ...project.entries.map(entry => `${'　'.repeat(entry.depth)}${entry.number} ${entry.title}`
        + (entry.row ? `｜执行人：${entry.row.assigneeNames.join('、') || '未设置'} ${this.absoluteUrl(entry.row.desktopPath) || ''}` : '')),
    ]), '', note].join('\n');
    if (batch.channel === 'personal') {
      const card = buildNotifyCard({
        title, template: 'orange', fields: [{ label: '统计周', value: range }, { label: '待补填', value: `${batch.rows.length} 项` }],
        blocks: projects.map((project) => ({
          title: `${project.number}. ${md(project.name)}`, color: 'orange',
          subtitle: `${project.count} 项待补填 · 负责人：${md(project.ownerNames.join('、') || '未设置')}`,
          tasks: project.entries.map((entry) => {
            const label = `${'　'.repeat(entry.depth - 1)}${entry.number} ${md(entry.title)}`;
            const url = entry.row && this.absoluteUrl(entry.row.desktopPath);
            return { title: entry.row ? label : `**${label}**`, details: entry.row ? [
              `执行人：${md(entry.row.assigneeNames.join('、') || '未设置')}`, ...(url ? [`[去补填](${url})`] : []),
            ] : [] };
          }),
        })),
        note,
        action: batch.rows.length === 1
          ? { label: '去补填', url: this.absoluteUrl(batch.rows[0].desktopPath) }
          : { label: '查看全部待补填', url: this.absoluteUrl('/my-todo?tab=todo') },
      });
      return this.notify.sendCard('weekly_progress_missing', Number(batch.target), card, fallback);
    }
    const card = weeklyProgressCard(projects, range, note, path => this.absoluteUrl(path));
    return this.notify.sendGroupCard('weekly_progress_missing', batch.target, card, fallback);
  }
}
