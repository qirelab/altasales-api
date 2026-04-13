import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateContractorChatAccessDto {
  @ApiProperty({
    example: true,
    description: 'Grant or revoke contractor access to order chat',
  })
  @IsBoolean()
  contractorChatAccess: boolean;
}
