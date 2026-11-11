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
import { UserEntity } from '../../system/user/user.entity.js';
import { ProductionOrderLineEntity } from '../order-line/production-order-line.entity.js';

export enum ProductionOrderStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
}

export enum ProductionOrderPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
}

@Entity('production_order')
export class ProductionOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_order_order_number', { unique: true })
  @Column({ name: 'order_number', type: 'varchar', length: 50, unique: true })
  orderNumber!: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: ProductionOrderStatus.DRAFT,
  })
  status!: ProductionOrderStatus;

  @Index('IDX_production_order_priority')
  @Column({
    type: 'varchar',
    length: 20,
    default: ProductionOrderPriority.NORMAL,
  })
  priority!: ProductionOrderPriority;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({ name: 'approved_at', type: 'datetime', precision: 6, nullable: true })
  approvedAt?: Date | null;

  @Index('IDX_production_order_approved_by')
  @Column({ name: 'approved_by_user_id', type: 'varchar', length: 36, nullable: true })
  approvedByUserId?: string | null;

  @ManyToOne(() => UserEntity, { eager: false, onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'approved_by_user_id' })
  approvedByUser?: UserEntity;

  @Index('IDX_production_order_created_by')
  @Column({ name: 'created_by_user_id', type: 'varchar', length: 36 })
  createdByUserId!: string;

  @ManyToOne(() => UserEntity, { eager: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: UserEntity;

  @OneToMany(() => ProductionOrderLineEntity, (line) => line.order, {
    cascade: false,
    eager: false,
  })
  lines?: ProductionOrderLineEntity[];

  @CreateDateColumn({ name: 'created_at', precision: 6 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', precision: 6 })
  updatedAt!: Date;

  @Index('IDX_production_order_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', precision: 6, nullable: true })
  deletedAt!: Date | null;
}
