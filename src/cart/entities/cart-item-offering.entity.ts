import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { ExpertPositionOffering } from '../../experts/entities/expert-position-offering.entity';
import { CartItem } from './cart-item.entity';

@Entity()
@Index('UQ_cart_item_offering_item_offering', ['cartItemId', 'expertPositionOfferingId'], {
  unique: true,
})
export class CartItemOffering {
  @ApiProperty({ description: 'Cart item offering ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Cart item ID' })
  @Column({ type: 'uuid' })
  cartItemId: string;

  @ManyToOne(() => CartItem, (cartItem) => cartItem.offerings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartItemId' })
  cartItem: CartItem;

  @ApiProperty({ description: 'Expert position offering ID' })
  @Column({ type: 'uuid' })
  expertPositionOfferingId: string;

  @ManyToOne(() => ExpertPositionOffering, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'expertPositionOfferingId' })
  expertPositionOffering: ExpertPositionOffering;

  @ApiProperty({ description: 'Offering quantity in cart', minimum: 1 })
  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn()
  createdAt: Date;
}
