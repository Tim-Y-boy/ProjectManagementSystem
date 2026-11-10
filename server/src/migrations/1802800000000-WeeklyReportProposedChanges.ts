import { MigrationInterface, QueryRunner } from 'typeorm';

export class WeeklyReportProposedChanges1802800000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE project_weekly_report_amendments
      ADD COLUMN IF NOT EXISTS proposed_content jsonb,
      ADD COLUMN IF NOT EXISTS draft_version integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE project_weekly_report_amendments DROP CONSTRAINT project_weekly_report_amendments_status_check`);
    await q.query(`ALTER TABLE project_weekly_report_amendments ADD CONSTRAINT project_weekly_report_amendments_status_check CHECK(status IN ('draft','pending','approved','rejected'))`);
    // Old requests contain only a reason, and cannot be approved without proposed content.
    await q.query(`UPDATE project_weekly_report_amendments SET status='rejected',comment='请先修改具体内容，再重新提交审批',reviewed_at=now() WHERE status='pending' AND proposed_content IS NULL`);
    // Preserve any edits made under the former unlock workflow as a separate proposal.
    await q.query(`INSERT INTO project_weekly_report_amendments(report_id,requester_id,approver_id,reason,status,original_report,proposed_content)
      SELECT r.id,a.requester_id,a.approver_id,a.reason,'draft',a.original_report,
        jsonb_build_object('overallStatus',COALESCE(r.overall_status,''),'achievements',r.achievements,'risks',r.risks,'coordination',r.coordination,'nextWeek',r.next_week)
      FROM project_weekly_reports r JOIN LATERAL (
        SELECT * FROM project_weekly_report_amendments a WHERE a.report_id=r.id ORDER BY a.id DESC LIMIT 1
      ) a ON true WHERE r.status='draft' AND a.status='approved' AND a.proposed_content IS NULL AND a.original_report->>'status'='submitted'`);
    await q.query(`UPDATE project_weekly_reports r SET status='submitted',overall_status=a.original_report->>'overall_status',
      achievements=a.original_report->>'achievements',risks=a.original_report->>'risks',coordination=a.original_report->>'coordination',
      next_week=a.original_report->>'next_week',evidence=a.original_report->'evidence',submitted_at=(a.original_report->>'submitted_at')::timestamptz,version=r.version+1,updated_at=now()
      FROM project_weekly_report_amendments a WHERE a.report_id=r.id AND a.status='draft' AND r.status='draft'`);
    await q.query(`UPDATE project_weekly_report_amendments a SET original_report=to_jsonb(r) FROM project_weekly_reports r WHERE a.report_id=r.id AND a.status='draft'`);
    await q.query(`CREATE UNIQUE INDEX weekly_report_one_draft_amendment ON project_weekly_report_amendments(report_id) WHERE status='draft'`);
  }
  async down(q: QueryRunner): Promise<void> {
    // Keep proposal content for audit even on application rollback.
    await q.query(`DROP INDEX weekly_report_one_draft_amendment`);
    await q.query(`UPDATE project_weekly_report_amendments SET status='rejected',comment='修改稿已关闭' WHERE status='draft'`);
    await q.query(`ALTER TABLE project_weekly_report_amendments DROP CONSTRAINT project_weekly_report_amendments_status_check`);
    await q.query(`ALTER TABLE project_weekly_report_amendments ADD CONSTRAINT project_weekly_report_amendments_status_check CHECK(status IN ('pending','approved','rejected'))`);
  }
}
