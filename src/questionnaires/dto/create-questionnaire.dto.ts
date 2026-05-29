import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsString,
  IsArray,
  IsIn,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsNotEmpty,
  ValidateNested,
  Max,
  Min,
  MaxLength,
  ArrayMinSize,
  Matches,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  LeadGenerationType,
  PreferredMessenger,
  QuestionnaireAnswers,
  SalesDirection,
} from '../entities/questionnaire.entity';

const SALES_DIRECTIONS: SalesDirection[] = ['B2B', 'B2C', 'B2G', 'B2B2C', 'C2C', 'B2P', 'D2C'];

const LEAD_GENERATION_TYPES: LeadGenerationType[] = ['inbound', 'outbound'];
const PREFERRED_MESSENGERS: PreferredMessenger[] = ['max', 'telegram'];

class DesiredResultDto {
  @ApiProperty({ enum: ['1m', '3m', '6m'] })
  @IsIn(['1m', '3m', '6m'])
  period: '1m' | '3m' | '6m';

  @ApiProperty({ example: 'Хочу 50 клиентов в месяц' })
  @IsString()
  @IsNotEmpty({ message: 'Описание результата обязательно' })
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

export class CreateQuestionnaireDto implements QuestionnaireAnswers {
  @ApiProperty({ example: 'Иван Иванов' })
  @IsString()
  @IsNotEmpty({ message: 'Имя обязательно' })
  name: string;

  @ApiProperty({ example: '+79001234567' })
  @IsString()
  @IsNotEmpty({ message: 'Телефон обязателен' })
  @Matches(/^\+\d{7,15}$/, {
    message: 'Некорректный формат телефона',
  })
  phone: string;

  @ApiProperty({ enum: PREFERRED_MESSENGERS })
  @IsNotEmpty({ message: 'Выберите мессенджер для связи' })
  @IsIn(PREFERRED_MESSENGERS, { message: 'Выберите мессенджер для связи' })
  preferredMessenger: PreferredMessenger;

  @ApiProperty({ example: '@username', description: 'Имя пользователя в выбранном мессенджере' })
  @IsString()
  @IsNotEmpty({ message: 'Укажите имя пользователя в мессенджере' })
  @MaxLength(64)
  @Matches(/^@[a-zA-Z0-9_]{5,32}$/, {
    message: 'Введите @username (от 5 до 32 символов после @)',
  })
  messengerUsername: string;

  @ApiProperty({ example: 'ООО "ТехноСтарт"' })
  @IsString()
  @IsNotEmpty({ message: 'Название компании обязательно' })
  companyName: string;

  @ApiProperty({ enum: SALES_DIRECTIONS, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Выберите хотя бы одно направление продаж' })
  @IsIn(SALES_DIRECTIONS, { each: true })
  salesDirection: SalesDirection[];

  @ApiProperty({ enum: LEAD_GENERATION_TYPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1, { message: 'Выберите тип лидогенерации' })
  @ArrayMaxSize(1, { message: 'Можно выбрать только один тип лидогенерации' })
  @IsIn(LEAD_GENERATION_TYPES, { each: true })
  leadGenerationTypes: LeadGenerationType[];

  @ApiProperty({ example: 'IT-решения для бизнеса' })
  @IsString()
  @IsNotEmpty({ message: 'Направление деятельности обязательно' })
  industry: string;

  @ApiProperty({ example: 'CRM-система' })
  @IsString()
  @IsNotEmpty({ message: 'Продукт обязателен' })
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
  @Min(1, { message: 'Желаемая выручка должна быть больше 0' })
  targetRevenue: number;

  @ApiProperty({ example: 50000, description: 'Средний чек (руб)' })
  @IsNumber()
  @Min(1, { message: 'Средний чек должен быть больше 0' })
  averageCheck: number;

  @ApiPropertyOptional({ example: 20, description: 'Конверсия лид → продажа, %' })
  @IsOptional()
  @IsNumber()
  @Min(1, { message: 'Конверсия должна быть больше 0' })
  @Max(100, { message: 'Конверсия не может быть больше 100' })
  conversionRate?: number;
}
