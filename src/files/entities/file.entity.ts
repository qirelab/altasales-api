import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { ChatMessage } from '../../chat/entities/chat-message.entity';
import { OrderItem } from '../../orders/entities/order-item.entity';

export enum FileSource {
  CLIENT = 'client',
  ADMIN = 'admin',
}

@Entity()
export class FileEntity {
  @ApiProperty({ description: 'File ID' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({ example: 'document.pdf', description: 'Original file name' })
  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @ApiProperty({ description: 'Stored file name on disk' })
  @Column({ type: 'varchar', length: 255 })
  storedName: string;

  @ApiProperty({ example: 'application/pdf', description: 'MIME type' })
  @Column({ type: 'varchar', length: 100 })
  mimeType: string;

  @ApiProperty({ example: 102400, description: 'File size in bytes' })
  @Column({ type: 'integer' })
  size: number;

  @ApiProperty({ description: 'Upload date' })
  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'uuid', nullable: true })
  messageId: string | null;

  @ManyToOne(() => ChatMessage, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'messageId' })
  message: ChatMessage | null;

  @ApiProperty({ description: 'ROP document ID for external storage', nullable: true })
  @Column({ type: 'varchar', nullable: true })
  ropDocumentId: string | null;

  @ApiProperty({ description: 'Order item ID', nullable: true })
  @Column({ type: 'uuid', nullable: true })
  orderItemId: string | null;

  @ManyToOne(() => OrderItem, (orderItem) => orderItem.files, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'orderItemId' })
  orderItem: OrderItem | null;

  @ApiProperty({ enum: FileSource, description: 'File source (client or admin)', default: FileSource.CLIENT })
  @Column({ type: 'enum', enum: FileSource, default: FileSource.CLIENT })
  source: FileSource;
}
