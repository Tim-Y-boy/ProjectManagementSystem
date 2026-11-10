import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDailyReportReads1801300000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE daily_report_read_state (
      user_id bigint PRIMARY KEY REFERENCES users(id), first_report_date date NOT NULL)`);
    await q.query(`CREATE TABLE daily_report_reads (
      user_id bigint NOT NULL REFERENCES users(id), report_date date NOT NULL,
      read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,report_date))`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE daily_report_reads,daily_report_read_state');
  }
}
