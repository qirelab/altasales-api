import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type SalesDirection = 'B2B' | 'B2C' | 'B2G' | 'B2B2C' | 'C2C' | 'B2P' | 'D2C';

export interface QuestionnaireComponents {
  crm: boolean;
  telephony: boolean;
  messenger: boolean;
  chatbot: boolean;
  voiceRobot: boolean;
  contactDatabase: boolean;
  salesManager: boolean;
  trainingSystem: boolean;
  analytics: boolean;
  scripts: boolean;
  callAnalysis: boolean;
  businessTrainer: boolean;
  salesHead: boolean;
}

export interface QuestionnaireAnswers {
  name: string;
  phone: string;
  salesDirection: SalesDirection[];
  industry: string;
  product: string;
  website?: string;
  desiredResult: {
    period: '1m' | '3m' | '6m';
    description: string;
  };
  productStage: 'new' | 'existing';
  components: QuestionnaireComponents;
  targetRevenue: number;
  averageCheck: number;
}

@Entity('questionnaires')
export class Questionnaire {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @Column({ type: 'uuid' })
  userId: string;

  @ApiProperty({ description: 'All form answers as JSON' })
  @Column({ type: 'jsonb' })
  answers: QuestionnaireAnswers;

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;
}
