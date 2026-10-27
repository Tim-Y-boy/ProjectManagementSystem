import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('task_assets')
export class TaskAsset {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Index()
  @Column({ name: 'project_id', type: 'bigint' })
  projectId: number;

  @Index()
  @Column({ name: 'task_id', type: 'bigint', nullable: true })
  taskId: number | null;

  @Index()
  @Column({ name: 'daily_update_id', type: 'bigint', nullable: true })
  dailyUpdateId: number | null;

  @Column({ name: 'linked_daily_update_ids', type: 'jsonb', default: () => "'[]'::jsonb" })
  linkedDailyUpdateIds: number[];

  @Column({ name: 'asset_type', length: 32 })
  assetType: string; // upload | feishu_doc | feishu_bitable | ppt | meeting_minutes | external_link | other

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ name: 'file_path', type: 'text', nullable: true })
  filePath: string | null;

  @Column({ name: 'original_name', length: 255, nullable: true })
  originalName: string | null;

  @Column({ name: 'mime_type', length: 120, nullable: true })
  mimeType: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: number | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index()
  @Column({ name: 'uploader_id', type: 'bigint' })
  uploaderId: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
