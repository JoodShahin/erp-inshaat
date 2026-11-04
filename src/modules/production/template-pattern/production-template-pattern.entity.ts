import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ProductionTemplateVersionEntity } from '../template-version/production-template-version.entity.js';
import { ProductionTemplatePatternOptionEntity } from '../template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';

@Entity('production_template_pattern')
export class ProductionTemplatePatternEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_template_pattern_template_id')
  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Index('IDX_production_template_pattern_version_id')
  @Column({ name: 'version_id', type: 'varchar', length: 36, nullable: true })
  versionId!: string | null;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Index('IDX_production_template_pattern_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionTemplateEntity, (tmpl) => tmpl.patterns, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'template_id' })
  template?: ProductionTemplateEntity;

  @ManyToOne(() => ProductionTemplateVersionEntity, (ver) => ver.patterns, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
    nullable: true,
  })
  @JoinColumn({ name: 'version_id' })
  version?: ProductionTemplateVersionEntity;

  @OneToMany(() => ProductionTemplatePatternOptionEntity, (opt) => opt.pattern, {
    cascade: false,
    eager: false,
  })
  options?: ProductionTemplatePatternOptionEntity[];

  @OneToOne(() => ProductionTemplateWorkflowItemEntity, (wf) => wf.pattern, {
    cascade: false,
    eager: false,
  })
  workflowItem?: ProductionTemplateWorkflowItemEntity;
}
