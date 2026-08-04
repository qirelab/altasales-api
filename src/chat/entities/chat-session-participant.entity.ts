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
import { ChatSession } from './chat-session.entity';
import { ChatParticipantRole } from './chat-participant-role.enum';

@Entity({ name: 'chat_session_participant' })
@Unique(['sessionId', 'userId'])
@Index(['sessionId'])
@Index(['userId'])
export class ChatSessionParticipant {
  @ApiProperty({ description: 'Participant record ID (UUID)' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Session ID' })
  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => ChatSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: ChatSession;

  @ApiProperty({ description: 'User ID of the participant' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ApiProperty({
    enum: ChatParticipantRole,
    description: 'Role of the participant inside the session',
  })
  @Column({
    type: 'enum',
    enum: ChatParticipantRole,
    enumName: 'chat_participant_role_enum',
  })
  role: ChatParticipantRole;

  @ApiProperty({ description: 'Date the participant joined the session' })
  @CreateDateColumn()
  addedAt: Date;

  @ApiProperty({
    description:
      'Timestamp of the last message this participant has seen. Null means ' +
      'the participant has never opened the session, in which case all ' +
      'messages sent by others count as unread.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true })
  lastReadAt: Date | null;
}
