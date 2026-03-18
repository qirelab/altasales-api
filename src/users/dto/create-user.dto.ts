import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '../entities/user-role.enum';

export class CreateUserDto {
  @ApiProperty({ example: 'John Doe', description: 'User name' })
  name: string;

  @ApiProperty({ example: 'john@example.com', description: 'User email' })
  email: string;

  @ApiProperty({ example: 'password123', description: 'User password', minLength: 6 })
  password: string;

  @ApiProperty({ enum: UserRole, example: UserRole.USER, required: false, description: 'User role' })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
