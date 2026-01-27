import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity()
export class User {
  @ApiProperty({ example: 1, description: 'User ID' })
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty({ example: 'John Doe', description: 'User name' })
  @Column()
  name: string;

  @ApiProperty({ example: 'john@example.com', description: 'User email' })
  @Column({ unique: true })
  email: string;

  @ApiProperty({ example: 'firebase-uid-123', description: 'Firebase UID' })
  @Column({ unique: true, nullable: true })
  firebaseUid: string;
}
