import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionYardEntity } from '../yard/production-yard.entity.js';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';

@Entity('production_yard_template')
@Index('UQ_production_yard_template_yard_template', ['yardId', 'templateId'], { unique: true })
export class ProductionYardTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_yard_template_yard_id')
  @Column({ name: 'yard_id', type: 'varchar', length: 36 })
  yardId!: string;

  @Index('IDX_production_yard_template_template_id')
  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36, nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToOne(() => ProductionYardEntity, (yard) => yard.yardTemplates, {
    eager: false,
    cascade: false,
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'yard_id' })
  yard?: ProductionYardEntity;

  @ManyToOne(() => ProductionTemplateEntity, (tmpl) => tmpl.yardTemplates, {
    eager: false,
    cascade: false,
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'template_id' })
  template?: ProductionTemplateEntity;
}
