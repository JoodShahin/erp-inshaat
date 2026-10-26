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
import { ProductionTemplatePatternOptionEntity } from '../template-pattern-option/production-template-pattern-option.entity.js';
import { ProductionDepartmentEntity } from '../department/production-department.entity.js';
import { ProductionTemplatePatternOptionTaskMaterialEntity } from '../template-pattern-option-task-material/production-template-pattern-option-task-material.entity.js';
import { ProductionTemplatePatternOptionTaskAttachmentEntity } from '../template-pattern-option-task-attachment/production-template-pattern-option-task-attachment.entity.js';
import { TaskDurationUnit } from '../task-duration/task-duration.types.js';

@Entity('production_template_pattern_option_task')
export class ProductionTemplatePatternOptionTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_template_option_task_option_id')
  @Column({ name: 'option_id', type: 'varchar', length: 36 })
  optionId!: string;

  @Index('IDX_production_template_option_task_department_id')
  @Column({ name: 'department_id', type: 'varchar', length: 36 })
  departmentId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Index('IDX_production_template_option_task_sort_order')
  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

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

  @Index('IDX_production_template_option_task_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionTemplatePatternOptionEntity, (opt) => opt.tasks, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'option_id' })
  option?: ProductionTemplatePatternOptionEntity;

  @ManyToOne(() => ProductionDepartmentEntity, {
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    eager: false,
  })
  @JoinColumn({ name: 'department_id' })
  department?: ProductionDepartmentEntity;

  @OneToMany(() => ProductionTemplatePatternOptionTaskMaterialEntity, (mat) => mat.task, {
    cascade: false,
    eager: false,
  })
  plannedMaterials?: ProductionTemplatePatternOptionTaskMaterialEntity[];

  @OneToMany(() => ProductionTemplatePatternOptionTaskAttachmentEntity, (att) => att.task, {
    cascade: false,
    eager: false,
  })
  attachments?: ProductionTemplatePatternOptionTaskAttachmentEntity[];
}
