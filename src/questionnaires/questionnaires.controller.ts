import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SessionGuard } from '../auth/guards/session.guard';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
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
    console.log('Запрос пришел на сервер');
    console.log(user);
    console.log(await this.questionnairesService.findByUserId(user.id));
    return this.questionnairesService.findByUserId(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get questionnaire by id' })
  async findOne(@Param('id') id: string) {
    return this.questionnairesService.findOne(id);
  }
}
