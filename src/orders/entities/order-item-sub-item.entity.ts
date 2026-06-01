import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Service } from '../../services/entities/service.entity';
import { FileEntity } from '../../files/entities/file.entity';
import { OrderStatus } from './order-status.enum';
import { OrderItem } from './order-item.entity';

@Entity()
@Unique(['orderItemId', 'serviceId'])
export class OrderItemSubItem {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Order sub-item ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Order item ID',
  })
  @Column({ type: 'uuid' })
  orderItemId: string;

  @ManyToOne(() => OrderItem, (orderItem) => orderItem.subItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderItemId' })
  orderItem: OrderItem;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service ID inside package',
  })
  @Column({ type: 'uuid' })
  serviceId: string;

  @ManyToOne(() => Service, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'serviceId' })
  service: Service;

  @ApiProperty({ enum: OrderStatus, description: 'Sub-item status' })
  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.Planned })
  status: OrderStatus;

  @OneToMany(() => FileEntity, (file) => file.orderItemSubItem)
  files: FileEntity[];
}
