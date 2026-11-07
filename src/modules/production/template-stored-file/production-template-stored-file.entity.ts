import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { UserEntity } from '../../system/user/user.entity.js';

@Entity('production_template_stored_file')
export class ProductionTemplateStoredFileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_template_stored_file_template_id')
  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Index('UQ_production_template_stored_file_storage_key', { unique: true })
  @Column({ name: 'storage_key', type: 'varchar', length: 500, unique: true })
  storageKey!: string;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255 })
  originalFileName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string | number;

  @Index('IDX_production_template_stored_file_created_by')
  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36, nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Index('IDX_production_template_stored_file_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionTemplateEntity, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    eager: false,
  })
  @JoinColumn({ name: 'template_id' })
  template!: ProductionTemplateEntity;

  @ManyToOne(() => UserEntity, {
    onDelete: 'SET NULL',
    onUpdate: 'RESTRICT',
    eager: false,
    nullable: true,
  })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser!: UserEntity | null;
}
