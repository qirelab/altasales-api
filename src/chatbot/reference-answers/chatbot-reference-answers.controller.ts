import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { SessionGuard } from '../../auth/guards/session.guard';
import { UserRole } from '../../users/entities/user-role.enum';
import { CreateReferenceAnswerDto } from './dto/create-reference-answer.dto';
import { ListReferenceAnswersDto } from './dto/list-reference-answers.dto';
import { UpdateReferenceAnswerDto } from './dto/update-reference-answer.dto';
import { ChatbotReferenceAnswersService } from './services/chatbot-reference-answers.service';

@ApiTags('chatbot-reference-answers')
@ApiCookieAuth('session')
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('chatbot/reference-answers')
export class ChatbotReferenceAnswersController {
  constructor(
    private readonly service: ChatbotReferenceAnswersService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create a reference answer',
    description:
      'Admin-only. Payload is scanned for PII (email/phone/INN/SNILS/passport/card/birth-date) — '
      + 'the request is rejected with 400 if any is detected.',
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Validation error or PII detected in payload.' })
  create(
    @Body() dto: CreateReferenceAnswerDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List reference answers with pagination and filters' })
  findAll(@Query() query: ListReferenceAnswersDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a reference answer by id' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a reference answer',
    description: 'PII scan is re-applied to changed text fields.',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReferenceAnswerDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a reference answer (soft-delete)',
    description: 'Sets status to archived. Restore via POST /:id/restore.',
  })
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.archive(id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived reference answer' })
  restore(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.restore(id);
  }
}
