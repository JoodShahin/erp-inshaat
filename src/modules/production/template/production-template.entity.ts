import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ProductionTemplateSpecificationEntity } from '../template-specification/production-template-specification.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionYardTemplateEntity } from '../yard-template/production-yard-template.entity.js';

@Entity('production_template')
export class ProductionTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'reference_number', type: 'varchar', length: 100, nullable: true })
  referenceNumber!: string | null;

  @Index('UQ_production_template_code', { unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Index('IDX_production_template_is_active')
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Index('IDX_production_template_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @OneToMany(() => ProductionTemplateSpecificationEntity, (spec) => spec.template, {
    cascade: false,
    eager: false,
  })
  specifications?: ProductionTemplateSpecificationEntity[];

  @OneToMany(() => ProductionTemplateStageEntity, (stage) => stage.template, {
    cascade: false,
    eager: false,
  })
  stages?: ProductionTemplateStageEntity[];

  @OneToMany(() => ProductionTemplateWorkflowItemEntity, (wf) => wf.template, {
    cascade: false,
    eager: false,
  })
  workflowItems?: ProductionTemplateWorkflowItemEntity[];

  @OneToMany(() => ProductionTemplatePatternEntity, (pat) => pat.template, {
    cascade: false,
    eager: false,
  })
  patterns?: ProductionTemplatePatternEntity[];

  @OneToMany(() => ProductionYardTemplateEntity, (yt) => yt.template, {
    cascade: false,
    eager: false,
  })
  yardTemplates?: ProductionYardTemplateEntity[];
}
