import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from './user-role.enum';

@Entity()
export class User {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'User ID (UUID)',
  })
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @ApiProperty({
    example: 1500.5,
    description: 'Total user balance',
  })
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance: number;

  @ApiProperty({
    enum: UserRole,
    example: UserRole.USER,
    description: 'User role',
  })
  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @ApiProperty({
    example: '40',
    description: 'ROP project ID for file storage',
    nullable: true,
  })
  @Column({ type: 'varchar', nullable: true })
  ropProjectId: string | null;

  @ApiPropertyOptional({
    description: 'When the user last viewed recommendation notifications',
  })
  @Column({ type: 'timestamptz', nullable: true })
  notificationsSeenAt: Date | null;

  @ApiPropertyOptional({
    description: 'When the admin last viewed paid-order notifications',
  })
  @Column({ type: 'timestamptz', nullable: true })
  adminOrderNotificationsSeenAt: Date | null;

  @ApiProperty({
    example: '2026-03-19T10:00:00.000Z',
    description: 'Registration date',
  })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({
    example: false,
    description: 'Whether the gift balance intro modal has been seen by the user',
  })
  @Column({ type: 'boolean', default: false })
  hasSeenGiftIntro: boolean;
}
