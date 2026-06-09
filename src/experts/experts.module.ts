import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminExpertGroupsController } from './admin-expert-groups.controller';
import { ExpertPosition } from './entities/expert-position.entity';
import { ExpertPositionMember } from './entities/expert-position-member.entity';
import { ExpertPositionOffering } from './entities/expert-position-offering.entity';
import { ExpertServicePrice } from './entities/expert-service-price.entity';
import { ExpertsController } from './experts.controller';
import { ExpertsService } from './experts.service';
import { User } from '../users/entities/user.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { OrderItemSubItem } from '../orders/entities/order-item-sub-item.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      ExpertPosition,
      ExpertPositionOffering,
      ExpertPositionMember,
      ExpertServicePrice,
      User,
      OrderItem,
      OrderItemSubItem,
    ]),
  ],
  controllers: [ExpertsController, AdminExpertGroupsController],
  providers: [ExpertsService],
  exports: [ExpertsService],
})
export class ExpertsModule { }
