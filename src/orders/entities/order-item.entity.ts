import {
  Check,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Service } from '../../services/entities/service.entity';
import { Order } from './order.entity';
import { FileEntity } from '../../files/entities/file.entity';
import { ServicePackage } from '../../packages/entities/package.entity';
import { OrderStatus } from './order-status.enum';
import { OrderItemSubItem } from './order-item-sub-item.entity';

@Entity()
@Index('UQ_order_item_order_service_not_null', ['orderId', 'serviceId'], {
  unique: true,
  where: '"serviceId" IS NOT NULL',
})
@Index('UQ_order_item_order_package_not_null', ['orderId', 'packageId'], {
  unique: true,
  where: '"packageId" IS NOT NULL',
})
@Check('CHK_order_item_service_xor_package', '("serviceId" IS NOT NULL) <> ("packageId" IS NOT NULL)')
export class OrderItem {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Order item ID',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Order ID',
  })
  @Column({ type: 'uuid', unique: true })
  orderId: string;

  @OneToOne(() => Order, (order) => order.item, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service ID',
  })
  @Column({ type: 'uuid', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => Service, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'serviceId' })
  service: Service | null;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Package ID',
  })
  @Column({ type: 'uuid', nullable: true })
  packageId: string | null;

  @ManyToOne(() => ServicePackage, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'packageId' })
  package: ServicePackage | null;

  @ApiPropertyOptional({ example: 10, description: 'Hours (contractor only)' })
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  hours: number | null;

  @ApiProperty({ example: 50000, description: 'Line total amount' })
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @ApiProperty({ enum: OrderStatus, description: 'Order item status' })
  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.Planned })
  status: OrderStatus;

  @OneToMany(() => FileEntity, (file) => file.orderItem)
  files: FileEntity[];

  @OneToMany(() => OrderItemSubItem, (subItem) => subItem.orderItem, { cascade: true })
  subItems: OrderItemSubItem[];
}
