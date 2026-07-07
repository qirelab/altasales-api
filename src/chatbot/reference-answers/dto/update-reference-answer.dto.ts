import { PartialType } from '@nestjs/swagger';
import { CreateReferenceAnswerDto } from './create-reference-answer.dto';

export class UpdateReferenceAnswerDto extends PartialType(CreateReferenceAnswerDto) {}
