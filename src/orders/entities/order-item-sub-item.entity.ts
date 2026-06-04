import {
  Check,
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Service } from '../../services/entities/service.entity';
import { ExpertPositionOffering } from '../../experts/entities/expert-position-offering.entity';
import { FileEntity } from '../../files/entities/file.entity';
import { OrderStatus } from './order-status.enum';
import { OrderItem } from './order-item.entity';

@Entity()
@Index('UQ_order_item_sub_item_order_service_not_null', ['orderItemId', 'serviceId'], {
  unique: true,
  where: '"serviceId" IS NOT NULL',
})
@Index('UQ_order_item_sub_item_order_offering_not_null', ['orderItemId', 'expertPositionOfferingId'], {
  unique: true,
  where: '"expertPositionOfferingId" IS NOT NULL',
})
@Check(
  'CHK_order_item_sub_item_ref',
  '("serviceId" IS NOT NULL) <> ("expertPositionOfferingId" IS NOT NULL)',
)
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

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Service ID inside package',
  })
  @Column({ type: 'uuid', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => Service, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'serviceId' })
  service: Service | null;

  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Expert position offering ID',
  })
  @Column({ type: 'uuid', nullable: true })
  expertPositionOfferingId: string | null;

  @ManyToOne(() => ExpertPositionOffering, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'expertPositionOfferingId' })
  expertPositionOffering: ExpertPositionOffering | null;

  @ApiPropertyOptional({
    example: 15000,
    description: 'Snapshot of unit price at checkout (expert offerings)',
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  unitPrice: number | null;

  @ApiProperty({ enum: OrderStatus, description: 'Sub-item status' })
  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.Planned })
  status: OrderStatus;

  @OneToMany(() => FileEntity, (file) => file.orderItemSubItem)
  files: FileEntity[];
}
