import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionExecutionPlanEntity } from './production-execution-plan.entity.js';
import { ProductionDepartmentEntity } from '../department/production-department.entity.js';
import { TaskDurationUnit } from '../task-duration/task-duration.types.js';

export enum ExecutionTaskSource {
  GENERAL = 'GENERAL',
  PATTERN_OPTION = 'PATTERN_OPTION',
}

export interface ExecutionTaskPlannedMaterialSnapshot {
  productId: string;
  productUnitId: string;
  plannedQuantity: string;
  productName?: string;
  productCode?: string;
  unitName?: string;
}

export interface ExecutionTaskAttachmentSnapshot {
  originalFileName: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: string | number;
  description: string | null;
  sortOrder: number;
}

@Entity('production_execution_task')
export class ProductionExecutionTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_prod_exec_task_plan_id')
  @Column({ name: 'plan_id', type: 'varchar', length: 36 })
  planId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'text', nullable: true, default: null })
  description!: string | null;

  @Index('IDX_prod_exec_task_department_id')
  @Column({ name: 'department_id', type: 'varchar', length: 36 })
  departmentId!: string;

  @Column({ name: 'department_name', type: 'varchar', length: 150, nullable: true, default: null })
  departmentName!: string | null;

  @Index('IDX_prod_exec_task_sort_order')
  @Column({ name: 'sort_order', type: 'int' })
  sortOrder!: number;

  @Column({
    name: 'task_source',
    type: 'varchar',
    length: 30,
    default: ExecutionTaskSource.GENERAL,
  })
  taskSource!: ExecutionTaskSource;

  @Column({ name: 'source_stage_id', type: 'varchar', length: 36, nullable: true, default: null })
  sourceStageId!: string | null;

  @Column({ name: 'source_task_id', type: 'varchar', length: 36, nullable: true, default: null })
  sourceTaskId!: string | null;

  @Column({ name: 'template_pattern_id', type: 'varchar', length: 36, nullable: true, default: null })
  templatePatternId!: string | null;

  @Column({ name: 'pattern_name', type: 'varchar', length: 150, nullable: true, default: null })
  patternName!: string | null;

  @Column({ name: 'template_pattern_option_id', type: 'varchar', length: 36, nullable: true, default: null })
  templatePatternOptionId!: string | null;

  @Column({ name: 'option_name', type: 'varchar', length: 150, nullable: true, default: null })
  optionName!: string | null;

  @Column({ name: 'estimated_duration_value', type: 'int', nullable: true, default: null })
  estimatedDurationValue!: number | null;

  @Column({ name: 'estimated_duration_unit', type: 'varchar', length: 20, nullable: true, default: null })
  estimatedDurationUnit!: TaskDurationUnit | null;

  @Column({ name: 'estimated_duration_minutes', type: 'int', nullable: true, default: null })
  estimatedDurationMinutes!: number | null;

  @Column({ name: 'estimated_cost', type: 'decimal', precision: 18, scale: 4, nullable: true, default: null })
  estimatedCost!: string | null;

  @Column({ name: 'planned_materials', type: 'json', nullable: true, default: null })
  plannedMaterials!: ExecutionTaskPlannedMaterialSnapshot[] | null;

  @Column({ name: 'attachments', type: 'json', nullable: true, default: null })
  attachments!: ExecutionTaskAttachmentSnapshot[] | null;

  @Index('IDX_prod_exec_task_is_active')
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'archived_at', type: 'datetime', precision: 6, nullable: true, default: null })
  archivedAt!: Date | null;

  @ManyToOne(() => ProductionExecutionPlanEntity, (plan) => plan.tasks, {
    eager: false,
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_id' })
  plan?: ProductionExecutionPlanEntity;

  @ManyToOne(() => ProductionDepartmentEntity, {
    eager: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'department_id' })
  department?: ProductionDepartmentEntity;

  @CreateDateColumn({ name: 'created_at', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 6 })
  updatedAt!: Date;

  @Index('IDX_prod_exec_task_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', precision: 6, nullable: true })
  deletedAt!: Date | null;
}
