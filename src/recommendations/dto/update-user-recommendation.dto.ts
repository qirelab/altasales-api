import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { RecommendationStatus } from '../entities/recommendation-status.enum';

export class UpdateUserRecommendationDto {
  @ApiProperty({
    enum: RecommendationStatus,
    description: 'New recommendation status selected by the current user',
  })
  @IsEnum(RecommendationStatus)
  status: RecommendationStatus;
}
