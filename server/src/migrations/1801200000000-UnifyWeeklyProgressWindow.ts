import { MigrationInterface, QueryRunner } from 'typeorm';

export class UnifyWeeklyProgressWindow1801200000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE weekly_progress_settings ADD COLUMN previous_enabled_at timestamptz`);
    await q.query(`UPDATE weekly_progress_settings SET previous_enabled_at=enabled_at,enabled_at=now() WHERE id=1`);
    await q.query(`UPDATE weekly_progress_checks SET status='suppressed',
      suppression_reason='统一周进展规则生效前的历史提醒停止追溯',last_checked_at=now() WHERE status='missing'`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE weekly_progress_settings SET enabled_at=COALESCE(previous_enabled_at,enabled_at) WHERE id=1`);
    await q.query(`ALTER TABLE weekly_progress_settings DROP COLUMN previous_enabled_at`);
  }
}
