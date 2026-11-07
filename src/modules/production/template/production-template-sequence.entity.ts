import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('production_template_sequence')
export class ProductionTemplateSequenceEntity {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  id!: string;

  @Column({ type: 'bigint', name: 'current_value', default: 0 })
  currentValue!: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
