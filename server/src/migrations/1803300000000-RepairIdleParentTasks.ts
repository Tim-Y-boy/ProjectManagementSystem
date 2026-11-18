import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairIdleParentTasks1803300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Repeat from the leaves upwards; cancelled children do not affect roll-up.
    await queryRunner.query(`DO $$
      DECLARE changed integer;
      BEGIN
        LOOP
          UPDATE tasks parent SET status='todo', completed_at=NULL
          WHERE parent.status='doing'
            AND EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=parent.id AND child.status<>'cancelled')
            AND NOT EXISTS(SELECT 1 FROM tasks child WHERE child.parent_id=parent.id AND child.status NOT IN ('todo','pending_confirm','cancelled'));
          GET DIAGNOSTICS changed = ROW_COUNT;
          EXIT WHEN changed=0;
        END LOOP;
      END $$`);
  }

  public async down(): Promise<void> {
    // Corrected derived states must not be restored to known-invalid values.
  }
}
