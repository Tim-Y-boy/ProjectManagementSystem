import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProjectWeeklyReportOwner1803100000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS weekly_report_owner_id bigint REFERENCES users(id)');
    await q.query(`UPDATE projects p SET weekly_report_owner_id=COALESCE(p.owner_id,
      (SELECT user_id FROM project_owners WHERE project_id=p.id ORDER BY id LIMIT 1))
      WHERE weekly_report_owner_id IS NULL`);
    await q.query('ALTER TABLE project_weekly_reports ADD COLUMN IF NOT EXISTS submitted_by bigint REFERENCES users(id)');
    await q.query(`UPDATE project_weekly_reports r SET submitted_by=COALESCE(
      (SELECT NULLIF(a.original_report->>'updated_by','')::bigint FROM project_weekly_report_amendments a
       WHERE a.report_id=r.id ORDER BY a.id LIMIT 1),r.updated_by)
      WHERE r.status='submitted' AND r.submitted_by IS NULL`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE project_weekly_reports DROP COLUMN IF EXISTS submitted_by');
    await q.query('ALTER TABLE projects DROP COLUMN IF EXISTS weekly_report_owner_id');
  }
}
