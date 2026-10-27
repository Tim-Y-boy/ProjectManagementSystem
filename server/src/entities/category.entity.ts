import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// 项目模板分类：名称 + 图标(emoji) + 主色，可在「模板管理」里增删改
// 模板的 category 存分类名（字符串），改名/删除时级联处理
@Entity('categories')
export class Category {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ length: 32, unique: true })
  name: string;

  @Column({ length: 16, default: '📁' })
  emoji: string;

  @Column({ length: 16, default: '#64748b' })
  color: string;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
