import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  type CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateAdminRecommendationDto } from './dto/create-admin-recommendation.dto';
import { UpdateAdminRecommendationDto } from './dto/update-admin-recommendation.dto';
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

  @Get('admin/user/:userId')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get recommendations assigned to specific user (admin)',
  })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'List of user recommendations for admin panel',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getUserRecommendationsForAdmin(@Param('userId') userId: string) {
    return this.recommendationsService.findAssignedToUserForAdmin(userId);
  }

  @Post('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Create recommendation for user (admin)',
  })
  @ApiResponse({ status: 201, description: 'Recommendation created' })
  @ApiResponse({ status: 400, description: 'Invalid recommendation payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({
    status: 409,
    description: 'This service is already recommended to this user',
  })
  @ApiResponse({ status: 404, description: 'User or service not found' })
  async createForAdmin(@Body() dto: CreateAdminRecommendationDto) {
    return this.recommendationsService.createForAdmin(dto);
  }

  @Patch('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update recommendation (admin)',
  })
  @ApiParam({ name: 'id', description: 'Recommendation ID' })
  @ApiResponse({ status: 200, description: 'Recommendation updated' })
  @ApiResponse({ status: 400, description: 'Invalid recommendation payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({
    status: 409,
    description: 'This service is already recommended to this user',
  })
  @ApiResponse({ status: 404, description: 'Recommendation/service/order not found' })
  async updateForAdmin(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRecommendationDto,
  ) {
    return this.recommendationsService.updateForAdmin(id, dto);
  }
}
