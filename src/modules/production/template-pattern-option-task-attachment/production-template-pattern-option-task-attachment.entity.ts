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
import { ProductionTemplatePatternOptionTaskEntity } from '../template-pattern-option-task/production-template-pattern-option-task.entity.js';
import { ProductionTemplateStoredFileEntity } from '../template-stored-file/production-template-stored-file.entity.js';
import { UserEntity } from '../../system/user/user.entity.js';

@Entity('production_template_pattern_option_task_attachment')
export class ProductionTemplatePatternOptionTaskAttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_pattern_task_attachment_task_id')
  @Column({ name: 'task_id', type: 'varchar', length: 36 })
  taskId!: string;

  @Index('IDX_production_pattern_task_attachment_file_id')
  @Column({ name: 'file_id', type: 'varchar', length: 36, nullable: true })
  fileId!: string | null;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255 })
  originalFileName!: string;

  @Index('IDX_production_pattern_task_attachment_storage_key')
  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: number | string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  @Index('IDX_production_pattern_task_attachment_sort_order')
  @Column({ name: 'sort_order', type: 'int', default: 1 })
  sortOrder!: number;

  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36, nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Index('IDX_production_pattern_task_attachment_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionTemplatePatternOptionTaskEntity, (task) => task.attachments, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'task_id' })
  task?: ProductionTemplatePatternOptionTaskEntity;

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
