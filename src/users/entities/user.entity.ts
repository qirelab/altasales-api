import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity()
export class User {
  @ApiProperty({ example: 1, description: 'User ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 'John', description: 'User first name' })
  @Column()
  name: string;

  @ApiProperty({ example: 'Doe', description: 'User last name' })
  @Column()
  lastName: string;

  @ApiProperty({ example: 'john@example.com', description: 'User email' })
  @Column({ unique: true })
  email: string;

  @ApiProperty({ example: '1234567890', description: 'User phone number' })
  @Column()
  phoneNumber: string;

  @ApiProperty({ example: 'firebase-uid-123', description: 'Firebase UID' })
  @Column({ unique: true, nullable: true })
  firebaseUid: string;
}
