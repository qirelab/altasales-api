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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';
import { Order } from '../../orders/entities/order.entity';
import { ChatSessionType } from './chat-session-type.enum';
import { ChatSessionParticipant } from './chat-session-participant.entity';
import { ChatHandoffTrigger } from './chat-handoff-trigger.enum';
import { ChatMessage } from './chat-message.entity';

// NOTE: the `(participantOneId, participantTwoId, orderId)` uniqueness only
// applies to legacy expert-per-order sessions; platform (AI) sessions are
// intentionally many-per-client. Postgres treats NULL as distinct in unique
// indexes, so the constraint currently allows multiple platform rows because
// `orderId` is NULL for them — if a future PG upgrade flips to
// `NULLS NOT DISTINCT`, this decorator must switch to a partial index that
// excludes `type = 'platform'` (see migration
// 1785000000000-RenameChatConversationToSession for the schema-level drop of
// UQ_platform_conversation_per_client).
@Entity({ name: 'chat_session' })
@Unique(['participantOneId', 'participantTwoId', 'orderId'])
export class ChatSession {
  @ApiProperty({ description: 'Session ID (UUID)' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({
    enum: ChatSessionType,
    description:
      'Session type. `expert` is the legacy client-expert-per-order chat. ' +
      '`platform` is an AI-consultant session between the client and the platform.',
  })
  @Column({
    type: 'enum',
    enum: ChatSessionType,
    enumName: 'chat_session_type_enum',
    default: ChatSessionType.Expert,
  })
  type: ChatSessionType;

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
    description: 'Related order ID for order-specific session',
    required: false,
    nullable: true,
  })
  @Column({ type: 'uuid', nullable: true })
  orderId: string | null;

  @ManyToOne(() => Order, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'orderId' })
  order: Order | null;

  @ApiPropertyOptional({
    description:
      'Session title derived from the client\'s first message. Null on freshly ' +
      'opened platform sessions until the client sends anything.',
    nullable: true,
  })
  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  @ApiProperty({ description: 'Creation date' })
  @CreateDateColumn()
  createdAt: Date;

  @ApiProperty({ description: 'Last update date' })
  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ChatMessage, (message) => message.session)
  messages: ChatMessage[];

  @OneToMany(
    () => ChatSessionParticipant,
    (participant) => participant.session,
  )
  participants: ChatSessionParticipant[];

  @ApiProperty({
    description:
      'True when the AI could not close the last client turn and a human ' +
      'operator is expected to step in. Set by the orchestrator, cleared ' +
      'when any non-AI participant sends a message in the session.',
  })
  @Column({ type: 'boolean', default: false })
  needsHumanHandoff: boolean;

  @ApiPropertyOptional({
    enum: ChatHandoffTrigger,
    description:
      'Reason the handoff was requested. Null when needsHumanHandoff is false.',
    nullable: true,
  })
  @Column({
    type: 'enum',
    enum: ChatHandoffTrigger,
    enumName: 'chat_handoff_trigger_enum',
    nullable: true,
    default: null,
  })
  handoffTrigger: ChatHandoffTrigger | null;

  @ApiPropertyOptional({
    description: 'Timestamp the handoff was requested. Null when not pending.',
    nullable: true,
  })
  @Column({ type: 'timestamptz', nullable: true, default: null })
  handoffRequestedAt: Date | null;
}
