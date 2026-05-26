import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Cart } from './cart.entity';
import { Service } from '../../services/entities/service.entity';
import { ServicePackage } from '../../packages/entities/package.entity';

@Entity()
@Index('UQ_cart_item_cart_service_not_null', ['cartId', 'serviceId'], {
  unique: true,
  where: '"serviceId" IS NOT NULL',
})
@Index('UQ_cart_item_cart_package_not_null', ['cartId', 'packageId'], {
  unique: true,
  where: '"packageId" IS NOT NULL',
})
@Check('CHK_cart_item_service_xor_package', '("serviceId" IS NOT NULL) <> ("packageId" IS NOT NULL)')
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

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @CreateDateColumn()
  createdAt: Date;
}
