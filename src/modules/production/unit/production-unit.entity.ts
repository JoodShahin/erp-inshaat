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
import { ProductionOrderEntity } from '../order/production-order.entity.js';
import { ProductionOrderLineEntity } from '../order-line/production-order-line.entity.js';
import { ProductionExecutionPlanEntity } from '../execution-plan/production-execution-plan.entity.js';
import { ProductionYardEntity } from '../yard/production-yard.entity.js';
import { ProductionUnitEventEntity } from './production-unit-event.entity.js';

export enum ProductionUnitStatus {
  CREATED = 'CREATED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('production_unit')
@Index('UQ_prod_unit_line_sequence', ['orderLineId', 'unitSequence'], { unique: true })
export class ProductionUnitEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_prod_unit_order_id')
  @Column({ name: 'order_id', type: 'varchar', length: 36 })
  orderId!: string;

  @Index('IDX_prod_unit_order_line_id')
  @Column({ name: 'order_line_id', type: 'varchar', length: 36 })
  orderLineId!: string;

  @Index('IDX_prod_unit_plan_id')
  @Column({ name: 'plan_id', type: 'varchar', length: 36 })
  planId!: string;

  @Column({ name: 'unit_sequence', type: 'int' })
  unitSequence!: number;

  @Column({ name: 'unit_number', type: 'varchar', length: 100 })
  unitNumber!: string;

  @Index('IDX_prod_unit_code')
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  code!: string | null;

  @Index('IDX_prod_unit_current_yard_id')
  @Column({ name: 'current_yard_id', type: 'varchar', length: 36, nullable: true, default: null })
  currentYardId!: string | null;

  @Index('IDX_prod_unit_status')
  @Column({
    type: 'varchar',
    length: 30,
    default: ProductionUnitStatus.CREATED,
  })
  status!: ProductionUnitStatus;

  @Index('IDX_prod_unit_is_cancelled')
  @Column({ name: 'is_cancelled', type: 'boolean', default: false })
  isCancelled!: boolean;

  @Column({ name: 'cancelled_at', type: 'datetime', precision: 6, nullable: true, default: null })
  cancelledAt!: Date | null;

  @Column({ name: 'cancellation_reason', type: 'text', nullable: true, default: null })
  cancellationReason!: string | null;

  @ManyToOne(() => ProductionOrderEntity, {
    eager: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order?: ProductionOrderEntity;

  @ManyToOne(() => ProductionOrderLineEntity, {
    eager: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'order_line_id' })
  line?: ProductionOrderLineEntity;

  @ManyToOne(() => ProductionExecutionPlanEntity, (plan) => plan.units, {
    eager: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_id' })
  plan?: ProductionExecutionPlanEntity;

  @ManyToOne(() => ProductionYardEntity, {
    eager: false,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'current_yard_id' })
  currentYard?: ProductionYardEntity;

  @OneToMany(() => ProductionUnitEventEntity, (event) => event.unit, {
    cascade: false,
    eager: false,
  })
  events?: ProductionUnitEventEntity[];

  @CreateDateColumn({ name: 'created_at', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 6 })
  updatedAt!: Date;

  @Index('IDX_prod_unit_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', precision: 6, nullable: true })
  deletedAt!: Date | null;
}
