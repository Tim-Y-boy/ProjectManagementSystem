import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddProjectWeeklyReports1802400000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE project_weekly_report_settings (id smallint PRIMARY KEY CHECK(id=1), enabled_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`INSERT INTO project_weekly_report_settings(id) VALUES(1)`);
    await q.query(`CREATE TABLE project_weekly_reports (
      id bigserial PRIMARY KEY, project_id bigint NOT NULL REFERENCES projects(id), week_start date NOT NULL,
      status varchar(16) NOT NULL DEFAULT 'missing' CHECK(status IN ('missing','draft','submitted')),
      overall_status varchar(16) NOT NULL DEFAULT 'normal' CHECK(overall_status IN ('normal','risk','blocked')),
      achievements text NOT NULL DEFAULT '', risks text NOT NULL DEFAULT '', coordination text NOT NULL DEFAULT '', next_week text NOT NULL DEFAULT '',
      version integer NOT NULL DEFAULT 0, evidence jsonb, submitted_at timestamptz, updated_by bigint REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,week_start), CHECK(extract(isodow FROM week_start)=1))`);
    await q.query(`CREATE TABLE project_weekly_report_versions (
      id bigserial PRIMARY KEY, report_id bigint NOT NULL REFERENCES project_weekly_reports(id) ON DELETE CASCADE,
      version integer NOT NULL, actor_id bigint NOT NULL REFERENCES users(id), status varchar(16) NOT NULL,
      snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(report_id,version))`);
    await q.query(`CREATE INDEX project_weekly_reports_pending ON project_weekly_reports(week_start) WHERE status <> 'submitted'`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE project_weekly_report_versions');
    await q.query('DROP TABLE project_weekly_reports');
    await q.query('DROP TABLE project_weekly_report_settings');
  }
}
