import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('task_logs')
export class TaskLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'task_id', type: 'bigint' })
  taskId: number;

  @Index()
  @Column({ name: 'project_id', type: 'bigint', nullable: true })
  projectId: number | null;

  @Column({ name: 'operator_id', type: 'bigint' })
  operatorId: number;

  @Column({ length: 32 })
  action: string; // create | update | transition | reassign | reject | archive ...

  @Column({ name: 'from_status', length: 20, nullable: true })
  fromStatus: string | null;

  @Column({ name: 'to_status', length: 20, nullable: true })
  toStatus: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, any> | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
