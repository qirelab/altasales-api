import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class UpdateRecommendationDependenciesDto {
  @ApiProperty({
    description: 'Prerequisite recommendation IDs',
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  dependencyIds: string[];
}
