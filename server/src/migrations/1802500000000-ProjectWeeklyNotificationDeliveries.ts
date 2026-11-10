import { MigrationInterface, QueryRunner } from 'typeorm';
export class ProjectWeeklyNotificationDeliveries1802500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE project_weekly_notification_deliveries (
      kind varchar(32) NOT NULL, week_start date NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(kind,week_start)
    )`);
    await queryRunner.query(`ALTER TABLE weekly_progress_deliveries ADD COLUMN owner_entry_sent boolean NOT NULL DEFAULT false`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE weekly_progress_deliveries DROP COLUMN owner_entry_sent');
    await queryRunner.query('DROP TABLE project_weekly_notification_deliveries');
  }
}
