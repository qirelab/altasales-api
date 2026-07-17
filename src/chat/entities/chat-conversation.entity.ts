import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { Order } from '../../orders/entities/order.entity';
import { ChatMessage } from './chat-message.entity';

@Entity()
@Unique(['participantOneId', 'participantTwoId', 'orderId'])
export class ChatConversation {
  @ApiProperty({ description: 'Conversation ID (UUID)' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'First participant ID (smaller UUID)' })
  @Column({ type: 'uuid' })
  participantOneId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participantOneId' })
  participantOne: User;

  @ApiProperty({ description: 'Second participant ID (larger UUID)' })
  @Column({ type: 'uuid' })
  participantTwoId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participantTwoId' })
  participantTwo: User;

  @ApiProperty({
    description: 'Related order ID for order-specific conversation',
    required: false,
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @ManyToOne(() => Order, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'orderId' })
  order: Order | null;

  @ApiProperty({ description: 'Creation date' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: 'Last update date' })
  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ChatMessage, (message) => message.conversation)
  messages: ChatMessage[];
}
