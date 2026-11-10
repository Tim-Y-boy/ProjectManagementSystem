// Shared by submission and the one-time backfill; unique event keys prevent duplicate delivery.
export const enqueueWeeklyAmendmentReviewSql = `INSERT INTO closure_notices(event_key,project_id,recipient_id,kind,payload)
  SELECT 'weekly-amendment:'||a.id||':review',r.project_id,a.approver_id,'weekly_amendment_review',
    jsonb_build_object('title','周报修改申请 · 待审批',
      'text',p.name||' · '||to_char(r.week_start,'YYYY-MM-DD')||E'\n申请人：'||requester.name||E'\n修改原因：'||a.reason||E'\n请查看修改前后内容并审批。',
      'path','/daily-report?tab=weekly&projectId='||r.project_id||'&weekStart='||to_char(r.week_start,'YYYY-MM-DD'),
      'mobilePath','/mobile/daily-report?tab=weekly&projectId='||r.project_id||'&weekStart='||to_char(r.week_start,'YYYY-MM-DD'),
      'label','查看并审批','amendmentId',a.id)
  FROM project_weekly_report_amendments a JOIN project_weekly_reports r ON r.id=a.report_id
  JOIN projects p ON p.id=r.project_id JOIN users requester ON requester.id=a.requester_id
  JOIN users approver ON approver.id=a.approver_id
  WHERE a.status='pending' AND approver.is_active=true AND approver.read_only=false
    AND ($1::bigint IS NULL OR r.id=$1) AND p.status<>'terminated' AND p.termination_state='none'
  ON CONFLICT(event_key,recipient_id) DO NOTHING`;
