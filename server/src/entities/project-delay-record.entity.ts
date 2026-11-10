import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('project_delay_records')
@Index('uq_project_delay_event', ['eventKey'], { unique: true })
export class ProjectDelayRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;
  @Column({ name: 'event_key', length: 200 }) eventKey: string;
  @Index() @Column({ name: 'project_id', type: 'bigint' }) projectId: number;
  @Column({ name: 'task_id', type: 'bigint', nullable: true }) taskId: number | null;
  @Column({ length: 32 }) kind: string;
  @Column({ type: 'jsonb' }) snapshot: Record<string, any>;
  @Column({ name: 'observed_at', type: 'timestamptz', default: () => 'NOW()' }) observedAt: Date;
}
