import { MigrationInterface, QueryRunner } from 'typeorm';

export class WeeklyReportSubmission1802600000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Old 'submitted' meant saved, not confirmed. Preserve closed historical reports;
    // turn still-open saved reports into drafts so nobody is locked by this upgrade.
    await q.query(`UPDATE project_weekly_reports SET status='draft',submitted_at=NULL
      WHERE status='submitted' AND ((week_start+7)::timestamp+interval '9 hours') AT TIME ZONE 'Asia/Shanghai' > now()`);
    await q.query(`ALTER TABLE project_weekly_reports ALTER COLUMN overall_status DROP NOT NULL,
      ALTER COLUMN overall_status DROP DEFAULT`);
    await q.query(`UPDATE project_weekly_reports SET overall_status=NULL WHERE status='missing'`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE project_weekly_reports SET overall_status='normal' WHERE overall_status IS NULL`);
    await q.query(`ALTER TABLE project_weekly_reports ALTER COLUMN overall_status SET DEFAULT 'normal',
      ALTER COLUMN overall_status SET NOT NULL`);
  }
}
