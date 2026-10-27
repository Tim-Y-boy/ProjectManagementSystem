import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user_roles')
@Index(['userId'])
export class UserRole {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ length: 32 })
  role: string; // admin | leader | dept_head | member
}