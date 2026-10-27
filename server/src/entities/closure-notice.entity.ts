import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('closure_notices')
@Index('uq_closure_notice_event_recipient', ['eventKey', 'recipientId'], { unique: true })
export class ClosureNotice {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;
  @Column({ name: 'event_key', length: 160 }) eventKey: string;
  @Index() @Column({ name: 'project_id', type: 'bigint' }) projectId: number;
  @Column({ name: 'recipient_id', type: 'bigint' }) recipientId: number;
  @Column({ length: 32 }) kind: string;
  @Column({ type: 'jsonb' }) payload: Record<string, any>;
  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true }) acknowledgedAt: Date | null;
  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true }) sentAt: Date | null;
  @Column({ name: 'next_attempt_at', type: 'timestamptz', default: () => 'NOW()' }) nextAttemptAt: Date;
  @Column({ type: 'int', default: 0 }) attempts: number;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt: Date;
}
