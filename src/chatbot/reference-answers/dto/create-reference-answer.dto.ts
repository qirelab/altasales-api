import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const QUESTION_MIN = 3;
const QUESTION_MAX = 2_000;
const ANSWER_MIN = 3;
const ANSWER_MAX = 5_000;
const TOPIC_MIN = 2;
const TOPIC_MAX = 200;

const trimIfString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateReferenceAnswerDto {
  @ApiProperty({ minLength: QUESTION_MIN, maxLength: QUESTION_MAX })
  @Transform(trimIfString)
  @IsString()
  @MinLength(QUESTION_MIN)
  @MaxLength(QUESTION_MAX)
  question!: string;

  @ApiProperty({ minLength: ANSWER_MIN, maxLength: ANSWER_MAX })
  @Transform(trimIfString)
  @IsString()
  @MinLength(ANSWER_MIN)
  @MaxLength(ANSWER_MAX)
  answer!: string;

  @ApiProperty({ minLength: TOPIC_MIN, maxLength: TOPIC_MAX })
  @Transform(trimIfString)
  @IsString()
  @MinLength(TOPIC_MIN)
  @MaxLength(TOPIC_MAX)
  topic!: string;

  @ApiPropertyOptional({ description: 'Optional link to KnowledgeDocument' })
  @IsOptional()
  @IsUUID()
  sourceDocumentId?: string;
}
