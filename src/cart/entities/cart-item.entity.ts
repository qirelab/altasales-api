import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExpertPosition } from '../../experts/entities/expert-position.entity';
import { ServicePackage } from '../../packages/entities/package.entity';
import { Service } from '../../services/entities/service.entity';
import { User } from '../../users/entities/user.entity';
import { Cart } from './cart.entity';
import { CartItemOffering } from './cart-item-offering.entity';

@Entity()
@Index('UQ_cart_item_cart_service_not_null', ['cartId', 'serviceId'], {
  unique: true,
  where: '"serviceId" IS NOT NULL',
})
@Index('UQ_cart_item_cart_package_not_null', ['cartId', 'packageId'], {
  unique: true,
  where: '"packageId" IS NOT NULL',
})
@Index('UQ_cart_item_cart_expert_position_not_null', ['cartId', 'expertPositionId'], {
  unique: true,
  where: '"expertPositionId" IS NOT NULL',
})
@Check(
  'CHK_cart_item_product_type',
  // eslint-disable-next-line max-len
  `((("serviceId" IS NOT NULL)::int) + (("packageId" IS NOT NULL)::int) + (("expertPositionId" IS NOT NULL)::int)) = 1`,
)
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  cartId: string;

  @ManyToOne(() => Cart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cartId' })
  cart: Cart;

  @Column({ type: 'uuid', nullable: true })
  serviceId: string | null;

  @ManyToOne(() => Service, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'serviceId' })
  service: Service | null;

  @Column({ type: 'uuid', nullable: true })
  packageId: string | null;

  @ManyToOne(() => ServicePackage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'packageId' })
  package: ServicePackage | null;

  @ApiPropertyOptional({ description: 'Expert position ID' })
  @Column({ type: 'uuid', nullable: true })
  expertPositionId: string | null;

  @ManyToOne(() => ExpertPosition, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'expertPositionId' })
  expertPosition: ExpertPosition | null;

  @ApiPropertyOptional({ description: 'Selected executor user ID (expert)' })
  @Column({ type: 'uuid', nullable: true })
  executorUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'executorUserId' })
  executor: User | null;

  @OneToMany(() => CartItemOffering, (offering) => offering.cartItem, { cascade: true })
  offerings: CartItemOffering[];

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn()
  createdAt: Date;
}
