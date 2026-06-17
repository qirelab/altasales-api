import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';

const MAX_METADATA_JSON_LENGTH = 10_000;
const MAX_TAGS_COUNT = 20;
const MAX_TAG_LENGTH = 64;

export class CreateKnowledgeUrlDocumentDto {
  @ApiProperty({ example: 'https://example.com/page' })
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url: string;

  @ApiProperty({ enum: KnowledgeBasePurpose })
  @IsEnum(KnowledgeBasePurpose)
  purpose: KnowledgeBasePurpose;

  @ApiPropertyOptional({ maxLength: 255 })
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional({
    description: 'Safe metadata object. Stored with the knowledge document.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateBy({
    name: 'isPlainMetadataObject',
    validator: {
      validate: isPlainObject,
      defaultMessage: () => 'metadata must be a plain JSON object',
    },
  })
  @ValidateBy({
    name: 'isBoundedMetadataObject',
    constraints: [MAX_METADATA_JSON_LENGTH],
    validator: {
      validate: (value: unknown) =>
        serializedSizeWithinLimit(value, MAX_METADATA_JSON_LENGTH),
      defaultMessage: () =>
        `metadata JSON must be at most ${MAX_METADATA_JSON_LENGTH} characters`,
    },
  })
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_TAGS_COUNT,
    maxLength: MAX_TAG_LENGTH,
  })
  @Transform(({ value }) => normalizeTags(value))
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_COUNT)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];
}

function isPlainObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializedSizeWithinLimit(value: unknown, limit: number): boolean {
  try {
    return JSON.stringify(value).length <= limit;
  } catch {
    return false;
  }
}

function normalizeTags(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const seen = new Set<string>();
  return value
    .map((tag) => typeof tag === 'string' ? tag.trim() : tag)
    .filter((tag) => {
      if (typeof tag !== 'string') {
        return true;
      }
      if (seen.has(tag)) {
        return false;
      }
      seen.add(tag);
      return true;
    });
}
