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

@Entity('production_template_editing_idempotency')
@Index('UQ_template_editing_idempotency', ['templateId', 'idempotencyKey'], { unique: true })
export class ProductionTemplateEditingIdempotencyEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64, nullable: true })
  requestHash?: string | null;

  @Column({ name: 'user_id', type: 'varchar', length: 36, nullable: true })
  userId?: string | null;

  @Column({ name: 'response_json', type: 'longtext' })
  responseJson!: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt!: Date;

  @ManyToOne(() => ProductionTemplateEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'template_id' })
  template?: ProductionTemplateEntity;
}
