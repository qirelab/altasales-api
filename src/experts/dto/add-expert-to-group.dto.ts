import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddExpertToGroupDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  expertId: string;
}
