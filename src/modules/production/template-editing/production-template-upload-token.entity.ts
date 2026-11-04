import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { UserEntity } from '../../system/user/user.entity.js';

@Entity('production_template_upload_token')
@Index('IDX_template_upload_token_template', ['templateId'])
@Index('IDX_template_upload_token_user', ['userId'])
@Index('IDX_template_upload_token_expires', ['expiresAt'])
export class ProductionTemplateUploadTokenEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string; // The opaque uploadToken (UUID)

  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255 })
  originalFileName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: number | string;

  @Column({ name: 'expires_at', type: 'datetime', precision: 6 })
  expiresAt!: Date;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;

  @ManyToOne(() => ProductionTemplateEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template?: ProductionTemplateEntity;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;
}
