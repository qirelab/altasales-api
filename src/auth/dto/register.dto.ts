import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'User password' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'John Doe', description: 'User name' })
  @IsString()
  name?: string;

  @ApiProperty({ example: '1234567890', description: 'User phone number' })
  @IsString()
  phoneNumber?: string;

  @ApiProperty({ example: 'Doe', description: 'User last name' })
  @IsString()
  lastName?: string;
}


