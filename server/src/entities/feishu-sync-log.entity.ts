import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('feishu_sync_logs')
export class FeishuSyncLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ length: 16 })
  type: string; // full | single

  @Column({ length: 16 })
  status: string; // success | fail

  @Column({ name: 'dept_count', type: 'int', default: 0 })
  deptCount: number;

  @Column({ name: 'user_count', type: 'int', default: 0 })
  userCount: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}