import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('task_daily_updates')
@Index(['taskId', 'workDate', 'userId'])
export class TaskDailyUpdate {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'project_id', type: 'bigint' })
  projectId: number;

  @Index()
  @Column({ name: 'task_id', type: 'bigint' })
  taskId: number;

  @Index()
  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Index()
  @Column({ name: 'work_date', type: 'date' })
  workDate: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'no_material_reason', type: 'text', nullable: true })
  noMaterialReason: string | null;

  @Column({ type: 'text', nullable: true })
  risk: string | null;

  @Column({ name: 'next_plan', type: 'text', nullable: true })
  nextPlan: string | null;

  @Column({ name: 'affect_due_date', type: 'boolean', default: false })
  affectDueDate: boolean;

  @Column({ length: 20, default: 'normal' })
  status: string; // normal | late | supplemented | exempted

  @Column({ name: 'exempt_reason', type: 'text', nullable: true })
  exemptReason: string | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
