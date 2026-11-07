import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ProductionTemplateStageEntity } from '../template-stage/production-template-stage.entity.js';
import { ProductionTemplatePatternEntity } from '../template-pattern/production-template-pattern.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';

@Entity('production_template_version')
@Index('UQ_production_template_version_template_version', ['templateId', 'version'], { unique: true })
export class ProductionTemplateVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_template_version_template_id')
  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Column({ type: 'varchar', length: 20 })
  version!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Index('IDX_production_template_version_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionTemplateEntity, (tmpl) => tmpl.versions, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'template_id' })
  template?: ProductionTemplateEntity;

  @OneToMany(() => ProductionTemplateStageEntity, (stage) => stage.version, {
    cascade: false,
    eager: false,
  })
  stages?: ProductionTemplateStageEntity[];

  @OneToMany(() => ProductionTemplatePatternEntity, (pattern) => pattern.version, {
    cascade: false,
    eager: false,
  })
  patterns?: ProductionTemplatePatternEntity[];

  @OneToMany(() => ProductionTemplateWorkflowItemEntity, (wf) => wf.version, {
    cascade: false,
    eager: false,
  })
  workflowItems?: ProductionTemplateWorkflowItemEntity[];
}
