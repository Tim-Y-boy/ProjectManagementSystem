import { weekHasWorkdaySql } from '../holidays/work-calendar';
// Keep the completion week, but do not require reports in later weeks while
// a fully completed project waits for closure. Missing completion dates are
// treated conservatively; cancelled tasks and roll-up parents do not count.
export function weekNeedsExecutionReportSql(projectId: string, week: string) {
  const leaf = `t.project_id=${projectId} AND t.status<>'cancelled'
    AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=t.id AND child.status<>'cancelled')`;
  return `NOT (EXISTS(SELECT 1 FROM tasks t WHERE ${leaf})
    AND NOT EXISTS(SELECT 1 FROM tasks t WHERE ${leaf}
      AND (t.status<>'done' OR t.completed_at IS NULL
        OR t.completed_at >= ((${week})::date::timestamp AT TIME ZONE 'Asia/Shanghai'))))`;
}
export const ELIGIBLE = `SELECT project.id AS project_id, w::date AS week_start
 FROM project_weekly_report_settings settings
 CROSS JOIN LATERAL generate_series(date_trunc('week',settings.enabled_at AT TIME ZONE 'Asia/Shanghai'),
 date_trunc('week',$1::timestamptz AT TIME ZONE 'Asia/Shanghai'),interval '1 week') w
 CROSS JOIN projects project
 WHERE project.plan_locked=true AND ${weekHasWorkdaySql('w')}
 AND ${weekNeedsExecutionReportSql('project.id', 'w')}
 AND project.created_at < ((w::date+7)::timestamp AT TIME ZONE 'Asia/Shanghai') AND project.created_at <= $1::timestamptz
 AND (project.start_at <= LEAST(w::date+6,($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date)
   OR EXISTS(SELECT 1 FROM task_daily_updates d WHERE d.project_id=project.id
     AND d.work_date<=LEAST(w::date+6,($1::timestamptz AT TIME ZONE 'Asia/Shanghai')::date) AND d.created_at <= $1::timestamptz)
   OR EXISTS(SELECT 1 FROM task_logs log WHERE log.project_id=project.id AND log.to_status IN ('doing','pending_accept','done')
     AND log.created_at < ((w::date+7)::timestamp AT TIME ZONE 'Asia/Shanghai') AND log.created_at <= $1::timestamptz)
   OR EXISTS(SELECT 1 FROM task_assets asset WHERE asset.project_id=project.id
     AND asset.created_at < ((w::date+7)::timestamp AT TIME ZONE 'Asia/Shanghai') AND asset.created_at <= $1::timestamptz))
 AND (COALESCE(project.terminated_at,project.archived_at) IS NULL
   OR COALESCE(project.terminated_at,project.archived_at) >= (w::timestamp AT TIME ZONE 'Asia/Shanghai'))
 AND NOT EXISTS (
   SELECT 1 FROM project_closures closed
   WHERE closed.project_id=project.id AND closed.status IN ('approved','voided')
     AND date_trunc('week',closed.reviewed_at AT TIME ZONE 'Asia/Shanghai') < w
     AND NOT EXISTS (
       SELECT 1 FROM closure_reopens reopened
       WHERE reopened.closure_id=closed.id AND reopened.project_id=project.id AND reopened.status='approved'
         AND reopened.reviewed_at >= closed.reviewed_at
         AND reopened.reviewed_at < ((w::date+7)::timestamp AT TIME ZONE 'Asia/Shanghai')
         AND reopened.reviewed_at <= $1::timestamptz))
 AND (project.status='active' OR project.archived_at IS NOT NULL OR project.terminated_at IS NOT NULL)`;
