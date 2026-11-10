import { MigrationInterface, QueryRunner } from 'typeorm';

export class WeeklyReportAmendments1802700000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE project_weekly_report_amendments (
      id bigserial PRIMARY KEY,
      report_id bigint NOT NULL REFERENCES project_weekly_reports(id),
      requester_id integer NOT NULL REFERENCES users(id),
      approver_id integer NOT NULL REFERENCES users(id),
      reason text NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      original_report jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      reviewed_at timestamptz,
      reviewed_by integer REFERENCES users(id),
      comment text NOT NULL DEFAULT ''
    )`);
    await q.query(`CREATE UNIQUE INDEX weekly_report_one_pending_amendment ON project_weekly_report_amendments(report_id) WHERE status='pending'`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE project_weekly_report_amendments'); }
}
