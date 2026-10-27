import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeeklyProgress1800200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE weekly_progress_settings (
      id smallint PRIMARY KEY CHECK (id = 1), enabled_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`INSERT INTO weekly_progress_settings(id) VALUES (1)`);
    await queryRunner.query(`CREATE TABLE weekly_progress_checks (
      id bigserial PRIMARY KEY, task_id bigint NOT NULL, project_id bigint NOT NULL,
      week_start date NOT NULL, week_end date NOT NULL,
      status varchar(16) NOT NULL CHECK(status IN ('missing','resolved','suppressed')),
      first_checked_at timestamptz NOT NULL DEFAULT now(), last_checked_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz, resolved_update_id bigint, submitted_at timestamptz,
      is_late boolean NOT NULL DEFAULT false, suppression_reason text,
      UNIQUE(task_id, week_start)
    )`);
    await queryRunner.query(`CREATE INDEX weekly_progress_checks_missing ON weekly_progress_checks(week_start, task_id) WHERE status='missing'`);
    await queryRunner.query(`CREATE TABLE weekly_progress_deliveries (
      id bigserial PRIMARY KEY, channel varchar(16) NOT NULL, target text NOT NULL, week_start date NOT NULL,
      success boolean NOT NULL DEFAULT false, attempts integer NOT NULL DEFAULT 0,
      sent_check_ids bigint[] NOT NULL DEFAULT '{}',
      attempted_at timestamptz, sent_at timestamptz, last_error text,
      UNIQUE(channel, target, week_start)
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE weekly_progress_deliveries`);
    await queryRunner.query(`DROP TABLE weekly_progress_checks`);
    await queryRunner.query(`DROP TABLE weekly_progress_settings`);
  }
}
