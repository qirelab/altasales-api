import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  IsIn,
  IsNumber,
  IsBoolean,
  IsOptional,
  ValidateNested,
  Min,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { SalesDirection } from '../entities/questionnaire.entity';

const SALES_DIRECTIONS: SalesDirection[] = ['B2B', 'B2C', 'B2G', 'B2B2C', 'C2C', 'B2P', 'D2C'];

class DesiredResultDto {
  @ApiProperty({ enum: ['1m', '3m', '6m'] })
  @IsIn(['1m', '3m', '6m'])
  period: '1m' | '3m' | '6m';

  @ApiProperty({ example: 'Хочу 50 клиентов в месяц' })
  @IsString()
  description: string;
}

class ComponentsDto {
  @IsBoolean() crm: boolean;
  @IsBoolean() telephony: boolean;
  @IsBoolean() messenger: boolean;
  @IsBoolean() chatbot: boolean;
  @IsBoolean() voiceRobot: boolean;
  @IsBoolean() contactDatabase: boolean;
  @IsBoolean() salesManager: boolean;
  @IsBoolean() trainingSystem: boolean;
  @IsBoolean() analytics: boolean;
  @IsBoolean() scripts: boolean;
  @IsBoolean() callAnalysis: boolean;
  @IsBoolean() businessTrainer: boolean;
  @IsBoolean() salesHead: boolean;
}

export class CreateQuestionnaireDto {
  @ApiProperty({ example: 'Иван Иванов' })
  @IsString()
  name: string;

  @ApiProperty({ example: '+79001234567' })
  @IsString()
  phone: string;

  @ApiProperty({ enum: SALES_DIRECTIONS, isArray: true })
  @IsArray()
  @IsIn(SALES_DIRECTIONS, { each: true })
  salesDirection: SalesDirection[];

  @ApiProperty({ example: 'IT-решения для бизнеса' })
  @IsString()
  industry: string;

  @ApiProperty({ example: 'CRM-система' })
  @IsString()
  product: string;

  @ApiPropertyOptional({ example: 'https://example.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiProperty({ type: DesiredResultDto })
  @ValidateNested()
  @Type(() => DesiredResultDto)
  desiredResult: DesiredResultDto;

  @ApiProperty({ enum: ['new', 'existing'] })
  @IsIn(['new', 'existing'])
  productStage: 'new' | 'existing';

  @ApiProperty({ type: ComponentsDto })
  @ValidateNested()
  @IsObject()
  @Type(() => ComponentsDto)
  components: ComponentsDto;

  @ApiProperty({ example: 5000000, description: 'Желаемая выручка (руб)' })
  @IsNumber()
  @Min(0)
  targetRevenue: number;

  @ApiProperty({ example: 50000, description: 'Средний чек (руб)' })
  @IsNumber()
  @Min(0)
  averageCheck: number;
}
