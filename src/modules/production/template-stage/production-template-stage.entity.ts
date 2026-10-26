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
import { ProductionDepartmentEntity } from '../department/production-department.entity.js';
import { ProductionTemplateStageMaterialEntity } from '../template-stage-material/production-template-stage-material.entity.js';
import { ProductionTemplateWorkflowItemEntity } from '../template-workflow-item/production-template-workflow-item.entity.js';
import { TaskDurationUnit } from '../task-duration/task-duration.types.js';

@Entity('production_template_stage')
export class ProductionTemplateStageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_template_stage_template_id')
  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Index('IDX_production_template_stage_department_id')
  @Column({ name: 'department_id', type: 'varchar', length: 36 })
  departmentId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'estimated_duration_value', type: 'int', nullable: true, default: null })
  estimatedDurationValue!: number | null;

  @Column({ name: 'estimated_duration_unit', type: 'varchar', length: 20, nullable: true, default: null })
  estimatedDurationUnit!: TaskDurationUnit | null;

  @Column({ name: 'estimated_duration_minutes', type: 'int', nullable: true })
  estimatedDurationMinutes!: number | null;

  @Column({ name: 'estimated_cost', type: 'decimal', precision: 18, scale: 4, nullable: true })
  estimatedCost!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Index('IDX_production_template_stage_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionTemplateEntity, (tmpl) => tmpl.stages, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'template_id' })
  template?: ProductionTemplateEntity;

  @ManyToOne(() => ProductionDepartmentEntity, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'department_id' })
  department?: ProductionDepartmentEntity;

  @OneToMany(() => ProductionTemplateStageMaterialEntity, (mat) => mat.stage, {
    cascade: false,
    eager: false,
  })
  plannedMaterials?: ProductionTemplateStageMaterialEntity[];

  @OneToMany('ProductionTemplateStageAttachmentEntity', (att: any) => att.stage, {
    cascade: false,
    eager: false,
  })
  attachments?: any[];

  @OneToOne(() => ProductionTemplateWorkflowItemEntity, (wf) => wf.stage, {
    cascade: false,
    eager: false,
  })
  workflowItem?: ProductionTemplateWorkflowItemEntity;

  /**
   * Transient/Derived sortOrder populated from workflowItem.sortOrder.
   * Not a database column on production_template_stage.
   */
  sortOrder?: number;
}
