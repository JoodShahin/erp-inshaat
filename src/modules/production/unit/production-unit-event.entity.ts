import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionUnitEntity } from './production-unit.entity.js';
import { UserEntity } from '../../system/user/user.entity.js';
import { ProductionDepartmentEntity } from '../department/production-department.entity.js';
import { ProductionExecutionTaskEntity } from '../execution-plan/production-execution-task.entity.js';

export enum ProductionUnitEventType {
  UNIT_CREATED = 'UNIT_CREATED',
  UNIT_CODE_ASSIGNED = 'UNIT_CODE_ASSIGNED',
  UNIT_YARD_ASSIGNED = 'UNIT_YARD_ASSIGNED',
  UNIT_YARD_TRANSFERRED = 'UNIT_YARD_TRANSFERRED',
  TASK_STATUS_CHANGED = 'TASK_STATUS_CHANGED',
  TASK_NOTE_ADDED = 'TASK_NOTE_ADDED',
  TASK_ATTACHMENT_ADDED = 'TASK_ATTACHMENT_ADDED',
  UNIT_CANCELLED = 'UNIT_CANCELLED',
}

@Entity('production_unit_event')
export class ProductionUnitEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_prod_unit_event_unit_id')
  @Column({ name: 'unit_id', type: 'varchar', length: 36 })
  unitId!: string;

  @Index('IDX_prod_unit_event_type')
  @Column({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: string;

  @Index('IDX_prod_unit_event_created_by')
  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36, nullable: true, default: null })
  createdByUserId!: string | null;

  @Index('IDX_prod_unit_event_occurred_at')
  @Column({ name: 'occurred_at', type: 'datetime', precision: 6 })
  occurredAt!: Date;

  @Index('IDX_prod_unit_event_department_id')
  @Column({ name: 'department_id', type: 'varchar', length: 36, nullable: true, default: null })
  departmentId!: string | null;

  @Index('IDX_prod_unit_event_task_id')
  @Column({ name: 'execution_task_id', type: 'varchar', length: 36, nullable: true, default: null })
  executionTaskId!: string | null;

  @Column({ name: 'previous_data', type: 'json', nullable: true, default: null })
  previousData!: Record<string, unknown> | null;

  @Column({ name: 'new_data', type: 'json', nullable: true, default: null })
  newData!: Record<string, unknown> | null;

  @Index('IDX_prod_unit_event_correlation_id')
  @Column({ name: 'correlation_id', type: 'varchar', length: 36, nullable: true, default: null })
  correlationId!: string | null;

  @Column({ name: 'metadata', type: 'json', nullable: true, default: null })
  metadata!: Record<string, unknown> | null;

  @ManyToOne(() => ProductionUnitEntity, (unit) => unit.events, {
    eager: false,
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'unit_id' })
  unit?: ProductionUnitEntity;

  @ManyToOne(() => UserEntity, {
    eager: false,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: UserEntity;

  @ManyToOne(() => ProductionDepartmentEntity, {
    eager: false,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'department_id' })
  department?: ProductionDepartmentEntity;

  @ManyToOne(() => ProductionExecutionTaskEntity, {
    eager: false,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'execution_task_id' })
  executionTask?: ProductionExecutionTaskEntity;

  @CreateDateColumn({ name: 'created_at', precision: 6 })
  createdAt!: Date;
}
