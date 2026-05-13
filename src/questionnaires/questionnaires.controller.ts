import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { SessionGuard } from '../auth/guards/session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/entities/user-role.enum';
import { QuestionnairesService } from './questionnaires.service';
import { CreateQuestionnaireDto } from './dto/create-questionnaire.dto';

@ApiTags('questionnaires')
@Controller('questionnaires')
@UseGuards(SessionGuard)
export class QuestionnairesController {
  constructor(private readonly questionnairesService: QuestionnairesService) { }

  @Post()
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Submit questionnaire' })
  @ApiResponse({ status: 201, description: 'Questionnaire saved' })
  async create(@Body() dto: CreateQuestionnaireDto, @CurrentUser() user: CurrentUserData) {
    return this.questionnairesService.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List all questionnaires' })
  @ApiResponse({ status: 200, description: 'List of questionnaires' })
  async findAll() {
    return this.questionnairesService.findAll();
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Get current user questionnaire' })
  @ApiResponse({ status: 200, description: 'Questionnaire or null' })
  async findMine(@CurrentUser() user: CurrentUserData) {
    return this.questionnairesService.findByUserId(user.id);
  }

  @Get('user/:userId')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get questionnaire by user ID (admin only)' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Questionnaire with assigned recommendations',
  })
  async findByUserId(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.questionnairesService.findByUserIdForAdmin(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get questionnaire by id' })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.questionnairesService.findOne(id);
  }
}
