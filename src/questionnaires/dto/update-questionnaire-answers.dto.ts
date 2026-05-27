import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  LeadGenerationType,
  PreferredMessenger,
  SalesDirection,
} from '../entities/questionnaire.entity';

const SALES_DIRECTIONS: SalesDirection[] = ['B2B', 'B2C', 'B2G', 'B2B2C', 'C2C', 'B2P', 'D2C'];
const LEAD_GENERATION_TYPES: LeadGenerationType[] = ['inbound', 'outbound'];
const PREFERRED_MESSENGERS: PreferredMessenger[] = ['max', 'telegram'];

class UpdateDesiredResultDto {
  @ApiPropertyOptional({ enum: ['1m', '3m', '6m'] })
  @IsOptional()
  @IsIn(['1m', '3m', '6m'])
  period?: '1m' | '3m' | '6m';

  @ApiPropertyOptional({ example: 'Хочу 50 клиентов в месяц' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Описание результата обязательно' })
  description?: string;
}

class UpdateComponentsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() crm?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() telephony?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() messenger?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() chatbot?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() voiceRobot?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() contactDatabase?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() salesManager?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() trainingSystem?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() analytics?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() scripts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() callAnalysis?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() businessTrainer?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() salesHead?: boolean;
}

export class UpdateQuestionnaireAnswersDto {
  @ApiPropertyOptional({ example: 'Иван Иванов' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Имя обязательно' })
  name?: string;

  @ApiPropertyOptional({ example: '+79001234567' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Телефон обязателен' })
  @Matches(/^\+\d{7,15}$/, {
    message: 'Некорректный формат телефона',
  })
  phone?: string;

  @ApiPropertyOptional({ enum: PREFERRED_MESSENGERS })
  @IsOptional()
  @IsIn(PREFERRED_MESSENGERS, { message: 'Выберите мессенджер для связи' })
  preferredMessenger?: PreferredMessenger;

  @ApiPropertyOptional({ example: 'ООО "ТехноСтарт"' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Название компании обязательно' })
  companyName?: string;

  @ApiPropertyOptional({ enum: SALES_DIRECTIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Выберите хотя бы одно направление продаж' })
  @IsIn(SALES_DIRECTIONS, { each: true })
  salesDirection?: SalesDirection[];

  @ApiPropertyOptional({ enum: LEAD_GENERATION_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Выберите хотя бы один тип лидогенерации' })
  @IsIn(LEAD_GENERATION_TYPES, { each: true })
  leadGenerationTypes?: LeadGenerationType[];

  @ApiPropertyOptional({ example: 'IT-решения для бизнеса' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Направление деятельности обязательно' })
  industry?: string;

  @ApiPropertyOptional({ example: 'CRM-система' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'Продукт обязателен' })
  product?: string;

  @ApiPropertyOptional({ example: 'https://example.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ type: UpdateDesiredResultDto })
  @IsOptional()
  @ValidateNested()
  @IsObject()
  @Type(() => UpdateDesiredResultDto)
  desiredResult?: UpdateDesiredResultDto;

  @ApiPropertyOptional({ enum: ['new', 'existing'] })
  @IsOptional()
  @IsIn(['new', 'existing'])
  productStage?: 'new' | 'existing';

  @ApiPropertyOptional({ type: UpdateComponentsDto })
  @IsOptional()
  @ValidateNested()
  @IsObject()
  @Type(() => UpdateComponentsDto)
  components?: UpdateComponentsDto;

  @ApiPropertyOptional({ example: 5000000, description: 'Желаемая выручка (руб)' })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Желаемая выручка должна быть больше 0' })
  targetRevenue?: number;

  @ApiPropertyOptional({ example: 50000, description: 'Средний чек (руб)' })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Средний чек должен быть больше 0' })
  averageCheck?: number;
}
