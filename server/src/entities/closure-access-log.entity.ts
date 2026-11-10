import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('closure_access_logs')
export class ClosureAccessLog {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;
  @Column({ name: 'closure_id', type: 'bigint' }) closureId: number;
  @Column({ name: 'user_id', type: 'bigint' }) userId: number;
  @Column({ length: 32 }) action: string;
  @Column({ type: 'jsonb', nullable: true }) payload: any;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt: Date;
}
