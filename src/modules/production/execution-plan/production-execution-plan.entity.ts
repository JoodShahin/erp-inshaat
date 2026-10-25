import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ProductionOrderEntity } from '../order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../order-line/production-order-line.entity.js';
import { ProductionTemplateEntity } from '../template/production-template.entity.js';
import { ProductionExecutionTaskEntity } from './production-execution-task.entity.js';
import { ProductionUnitEntity } from '../unit/production-unit.entity.js';

export interface ExecutionPlanPatternSummaryItem {
  patternId: string;
  patternName: string;
  optionId: string;
  optionName: string;
}

export interface ExecutionPlanSpecificationSnapshot {
  name: string;
  value: string;
  unit: string | null;
  sortOrder: number;
}

@Entity('production_execution_plan')
export class ProductionExecutionPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_prod_exec_plan_order_id')
  @Column({ name: 'order_id', type: 'varchar', length: 36 })
  orderId!: string;

  @Index('UQ_prod_exec_plan_order_line_id', { unique: true })
  @Column({ name: 'order_line_id', type: 'varchar', length: 36, unique: true })
  orderLineId!: string;

  @Index('IDX_prod_exec_plan_template_id')
  @Column({ name: 'template_id', type: 'varchar', length: 36 })
  templateId!: string;

  @Column({ name: 'template_name', type: 'varchar', length: 150 })
  templateName!: string;

  @Column({ name: 'template_code', type: 'varchar', length: 50 })
  templateCode!: string;

  @Column({ name: 'template_reference_number', type: 'varchar', length: 100, nullable: true, default: null })
  templateReferenceNumber!: string | null;

  @Column({ name: 'template_description', type: 'text', nullable: true, default: null })
  templateDescription!: string | null;

  @Column({ name: 'line_quantity', type: 'int' })
  lineQuantity!: number;

  @Column({ name: 'configuration_hash', type: 'char', length: 64 })
  configurationHash!: string;

  @Column({ name: 'pattern_summary', type: 'json', nullable: true, default: null })
  patternSummary!: ExecutionPlanPatternSummaryItem[] | null;

  @Column({ name: 'specifications', type: 'json', nullable: true, default: null })
  specifications!: ExecutionPlanSpecificationSnapshot[] | null;

  @ManyToOne(() => ProductionOrderEntity, {
    eager: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order?: ProductionOrderEntity;

  @OneToOne(() => ProductionOrderLineEntity, {
    eager: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'order_line_id' })
  line?: ProductionOrderLineEntity;

  @ManyToOne(() => ProductionTemplateEntity, {
    eager: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'template_id' })
  template?: ProductionTemplateEntity;

  @OneToMany(() => ProductionExecutionTaskEntity, (task) => task.plan, {
    cascade: false,
    eager: false,
  })
  tasks?: ProductionExecutionTaskEntity[];

  @OneToMany(() => ProductionUnitEntity, (unit) => unit.plan, {
    cascade: false,
    eager: false,
  })
  units?: ProductionUnitEntity[];

  @CreateDateColumn({ name: 'created_at', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 6 })
  updatedAt!: Date;

  @Index('IDX_prod_exec_plan_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', precision: 6, nullable: true })
  deletedAt!: Date | null;
}
