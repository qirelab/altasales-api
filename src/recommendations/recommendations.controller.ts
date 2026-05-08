import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@Controller('recommendations')
@UseGuards(SessionGuard)
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) { }

  @Get('my')
  @ApiOperation({
    summary: 'Get recommendations assigned to current user',
    description:
      'Returns recommendations linked to current user with service/document details.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user recommendations',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyRecommendations(
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.recommendationsService.findAssignedToUser(user.id);
  }
}
