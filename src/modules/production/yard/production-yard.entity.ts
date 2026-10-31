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
  Check,
} from 'typeorm';
import { ProductionDepartmentEntity } from '../department/production-department.entity.js';
import { ProductionYardEngineerEntity } from '../team/entities/production-yard-engineer.entity.js';
import { ProductionYardTemplateEntity } from '../yard-template/production-yard-template.entity.js';

@Entity('production_yard')
@Check('CHK_production_yard_capacity', '`capacity` >= 1')
export class ProductionYardEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IDX_production_yard_department_id')
  @Column({ name: 'department_id', type: 'varchar', length: 36 })
  departmentId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Index('UQ_production_yard_code', { unique: true })
  @Column({ type: 'varchar', length: 50 })
  code!: string;

  @Column({ type: 'int' })
  capacity!: number;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Index('IDX_production_yard_is_active')
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Index('IDX_production_yard_deleted_at')
  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => ProductionDepartmentEntity, (dept) => dept.yards, {
    eager: false,
    cascade: false,
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'department_id' })
  department!: ProductionDepartmentEntity;

  @OneToMany(() => ProductionYardEngineerEntity, (ye) => ye.yard, {
    eager: false,
    cascade: false,
  })
  engineerMappings!: ProductionYardEngineerEntity[];

  @OneToMany(() => ProductionYardTemplateEntity, (yt) => yt.yard, {
    eager: false,
    cascade: false,
  })
  yardTemplates?: ProductionYardTemplateEntity[];
}
