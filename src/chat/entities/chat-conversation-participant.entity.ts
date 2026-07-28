import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { ChatConversation } from './chat-conversation.entity';
import { ChatParticipantRole } from './chat-participant-role.enum';

@Entity()
@Unique(['conversationId', 'userId'])
@Index(['conversationId'])
@Index(['userId'])
export class ChatConversationParticipant {
  @ApiProperty({ description: 'Participant record ID (UUID)' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Conversation ID' })
  @Column({ type: 'uuid' })
  conversationId: string;

  @ManyToOne(() => ChatConversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: ChatConversation;

  @ApiProperty({ description: 'User ID of the participant' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({
    enum: ChatParticipantRole,
    description: 'Role of the participant inside the conversation',
  })
  @Column({ type: 'enum', enum: ChatParticipantRole })
  role: ChatParticipantRole;

  @ApiProperty({ description: 'Date the participant joined the conversation' })
  @CreateDateColumn()
  addedAt: Date;

  @ApiProperty({
    description:
      'Timestamp of the last message this participant has seen. Null means ' +
      'the participant has never opened the conversation, in which case all ' +
      'messages sent by others count as unread.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  lastReadAt: Date | null;
}
