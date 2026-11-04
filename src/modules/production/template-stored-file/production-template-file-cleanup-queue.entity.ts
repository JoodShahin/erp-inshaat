import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FileCleanupStatus {
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
}

@Entity('production_template_file_cleanup_queue')
export class ProductionTemplateFileCleanupQueueEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_prod_template_cleanup_file_id')
  @Column({ name: 'file_id', type: 'varchar', length: 36 })
  fileId!: string;

  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string;

  @Index('IDX_prod_template_cleanup_status')
  @Column({
    type: 'enum',
    enum: FileCleanupStatus,
    default: FileCleanupStatus.PENDING,
  })
  status!: FileCleanupStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @Index('IDX_prod_template_cleanup_next_retry')
  @Column({ name: 'next_retry_at', type: 'datetime', nullable: true })
  nextRetryAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
