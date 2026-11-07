import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ProductionTemplateVersionEntity } from '../template-version/production-template-version.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';

export type ProductionTemplateWorkflowItemType = 'STAGE' | 'PATTERN';

@Entity('production_template_workflow_item')
export class ProductionTemplateWorkflowItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_template_workflow_item_template_id')
  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Index('IDX_production_template_workflow_item_version_id')
  @Column({ name: 'version_id', type: 'varchar', length: 36, nullable: true })
  versionId!: string | null;

  @Column({ name: 'item_type', type: 'varchar', length: 20 })
  itemType!: ProductionTemplateWorkflowItemType;

  @Index('UQ_production_template_workflow_item_stage_id', { unique: true })
  @Column({ name: 'stage_id', type: 'varchar', length: 36, nullable: true })
  stageId!: string | null;

  @Index('UQ_production_template_workflow_item_pattern_id', { unique: true })
  @Column({ name: 'pattern_id', type: 'varchar', length: 36, nullable: true })
  patternId!: string | null;

  @Index('IDX_production_template_workflow_item_sort_order')
  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Index('IDX_production_template_workflow_item_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionTemplateEntity, (tmpl) => tmpl.workflowItems, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'template_id' })
  template?: ProductionTemplateEntity;

  @ManyToOne(() => ProductionTemplateVersionEntity, (ver) => ver.workflowItems, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
    nullable: true,
  })
  @JoinColumn({ name: 'version_id' })
  version?: ProductionTemplateVersionEntity;

  @OneToOne(() => ProductionTemplateStageEntity, (stage) => stage.workflowItem, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'stage_id' })
  stage?: ProductionTemplateStageEntity;

  @OneToOne(() => ProductionTemplatePatternEntity, (pattern) => pattern.workflowItem, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'pattern_id' })
  pattern?: ProductionTemplatePatternEntity;
}
