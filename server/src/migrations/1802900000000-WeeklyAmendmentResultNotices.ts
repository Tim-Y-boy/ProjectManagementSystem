import { MigrationInterface, QueryRunner } from 'typeorm';

export class WeeklyAmendmentResultNotices1802900000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Backfill only the latest application per report; ignore system-returned legacy requests.
    await q.query(`WITH latest AS (
      SELECT DISTINCT ON (report_id) * FROM project_weekly_report_amendments ORDER BY report_id,id DESC
    ), results AS (
      SELECT a.*,r.project_id,to_char(r.week_start,'YYYY-MM-DD') AS week,p.name AS project_name,u.name AS reviewer_name,
        '/daily-report?tab=weekly&projectId='||r.project_id||'&weekStart='||to_char(r.week_start,'YYYY-MM-DD') AS path
      FROM latest a JOIN project_weekly_reports r ON r.id=a.report_id JOIN projects p ON p.id=r.project_id
      JOIN users u ON u.id=a.reviewed_by JOIN users recipient ON recipient.id=a.requester_id
      WHERE a.status IN ('approved','rejected') AND recipient.read_only=false
    ) INSERT INTO closure_notices(event_key,project_id,recipient_id,kind,payload)
      SELECT 'weekly-amendment:'||id||':result',project_id,requester_id,'weekly_amendment_result',
        jsonb_build_object('title',CASE WHEN status='approved' THEN '周报修改申请已通过' ELSE '周报修改申请已退回' END,
          'text',project_name||' · '||week||E'\n审批人：'||reviewer_name||E'\n'||
            CASE WHEN status='approved' THEN '修改内容已生效，正式周报保持锁定。' ELSE '请根据审批意见修改后重新提交审批，正式周报保持不变。' END||
            CASE WHEN comment<>'' THEN E'\n审批意见：'||comment ELSE '' END,
          'path',path,'mobilePath','/mobile'||path,'label',CASE WHEN status='approved' THEN '查看周报' ELSE '查看并修改周报' END,
          'amendmentId',id,'result',status)
      FROM results ON CONFLICT(event_key,recipient_id) DO NOTHING`);
  }
  async down(): Promise<void> { /* Preserve delivered notifications and acknowledgement history. */ }
}
