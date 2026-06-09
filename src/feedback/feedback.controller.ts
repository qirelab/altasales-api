import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackAdminQueryDto } from './dto/feedback-query.dto';
import { UpdateFeedbackStatusDto } from './dto/update-feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @UseGuards(SessionGuard)
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateFeedbackDto,
  ) {
    return this.feedbackService.createForUser(user.id, dto);
  }

  @Get('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  getAdminList(@Query() query: FeedbackAdminQueryDto) {
    return this.feedbackService.findAdminList(query);
  }

  @Patch('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeedbackStatusDto,
  ) {
    return this.feedbackService.updateStatus(id, dto);
  }
}
