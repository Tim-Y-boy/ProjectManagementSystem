import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ length: 32 })
  type: string;

  @Index()
  @Column({ name: 'recipient_id', type: 'bigint', nullable: true })
  recipientId: number | null;

  @Column({ length: 128, nullable: true })
  target: string | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, any> | null;

  @Column({ default: false })
  success: boolean;

  @Column({ name: 'retry_count', default: 0 })
  retryCount: number;

  @Index()
  @Column({ name: 'project_id', type: 'bigint', nullable: true })
  projectId: number | null;

  @Index()
  @Column({ name: 'task_id', type: 'bigint', nullable: true })
  taskId: number | null;

  @Index()
  @Column({ name: 'plan_change_id', type: 'bigint', nullable: true })
  planChangeId: number | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
