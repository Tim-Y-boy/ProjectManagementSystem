import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('task_asset_versions')
@Index(['assetId', 'versionNo'], { unique: true })
export class TaskAssetVersion {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;
  @Column({ name: 'asset_id', type: 'bigint' }) assetId: number;
  @Column({ name: 'version_no', type: 'integer' }) versionNo: number;
  @Column({ length: 200 }) title: string;
  @Column({ name: 'original_name', length: 255, nullable: true }) originalName: string | null;
  @Column({ name: 'file_path', type: 'text' }) filePath: string;
  @Column({ name: 'mime_type', length: 120, nullable: true }) mimeType: string | null;
  @Column({ name: 'file_size', type: 'bigint', nullable: true }) fileSize: number | null;
  @Column({ name: 'uploader_id', type: 'bigint' }) uploaderId: number;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'NOW()' }) createdAt: Date;
  @Column({ type: 'text', nullable: true }) reason: string | null;
}
