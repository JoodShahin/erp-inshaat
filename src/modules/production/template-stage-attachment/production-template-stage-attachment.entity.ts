import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplateStoredFileEntity } from '../template-stored-file/production-template-stored-file.entity.js';
import { UserEntity } from '../../system/user/user.entity.js';

@Entity('production_template_stage_attachment')
export class ProductionTemplateStageAttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_template_stage_attachment_stage_id')
  @Column({ name: 'stage_id', type: 'varchar', length: 36 })
  stageId!: string;

  @Index('IDX_production_template_stage_attachment_file_id')
  @Column({ name: 'file_id', type: 'varchar', length: 36, nullable: true })
  fileId!: string | null;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255 })
  originalFileName!: string;

  @Index('IDX_production_template_stage_attachment_storage_key')
  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string | number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Index('IDX_production_template_stage_attachment_sort_order')
  @Column({ name: 'sort_order', type: 'int', default: 1 })
  sortOrder!: number;

  @Index('IDX_production_template_stage_attachment_created_by')
  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36, nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Index('IDX_production_template_stage_attachment_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionTemplateStageEntity, (stage) => stage.attachments, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'stage_id' })
  stage?: ProductionTemplateStageEntity;

  @ManyToOne(() => ProductionTemplateStoredFileEntity, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    eager: false,
    nullable: true,
  })
  @JoinColumn({ name: 'file_id' })
  storedFile?: ProductionTemplateStoredFileEntity | null;

  @ManyToOne(() => UserEntity, {
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    eager: false,
    nullable: true,
  })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: UserEntity;
}
