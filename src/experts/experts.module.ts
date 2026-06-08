import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExpertPosition } from './entities/expert-position.entity';
import { ExpertPositionMember } from './entities/expert-position-member.entity';
import { ExpertPositionMemberOffering } from './entities/expert-position-member-offering.entity';
import { ExpertPositionOffering } from './entities/expert-position-offering.entity';
import { ExpertsController } from './experts.controller';
import { ExpertsService } from './experts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExpertPosition,
      ExpertPositionOffering,
      ExpertPositionMember,
      ExpertPositionMemberOffering,
    ]),
  ],
  controllers: [ExpertsController],
  providers: [ExpertsService],
  exports: [ExpertsService],
})
export class ExpertsModule { }
