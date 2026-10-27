import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  JoinColumn,
} from 'typeorm';
import { Department } from './department.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index({ unique: true })
  @Column({ name: 'feishu_user_id', length: 64 })
  feishuUserId: string;

  @Column({ name: 'open_id', length: 64, nullable: true })
  openId: string | null;

  @Column({ name: 'union_id', length: 64, nullable: true })
  unionId: string | null;

  @Column({ length: 64 })
  name: string;

  @Column({ name: 'employee_id', length: 64, nullable: true })
  employeeId: string | null;

  @Column({ length: 128, nullable: true })
  email: string | null;

  @Column({ name: 'job_title', length: 128, nullable: true })
  jobTitle: string | null;

  @Column({ name: 'avatar_url', length: 512, nullable: true })
  avatarUrl: string | null;

  @ManyToOne(() => Department, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'dept_id' })
  dept: Department | null;

  @Column({ name: 'dept_id', type: 'bigint', nullable: true })
  deptId: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'synced_at', type: 'timestamptz', nullable: true })
  syncedAt: Date | null;
}