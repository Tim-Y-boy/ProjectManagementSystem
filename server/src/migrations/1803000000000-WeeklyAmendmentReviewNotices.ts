import { MigrationInterface, QueryRunner } from 'typeorm';
import { enqueueWeeklyAmendmentReviewSql } from '../modules/project-weekly-reports/weekly-amendment-notice';

export class WeeklyAmendmentReviewNotices1803000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> { await q.query(enqueueWeeklyAmendmentReviewSql,[null]); }
  async down(): Promise<void> { /* Preserve notification delivery history. */ }
}
