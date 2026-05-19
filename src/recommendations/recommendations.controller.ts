import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  ParseUUIDPipe,
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
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { UpdateAdminRecommendationDto } from './dto/update-admin-recommendation.dto';
import { UpdateRecommendationDependenciesDto } from './dto/update-recommendation-dependencies.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@Controller('recommendations')
@UseGuards(SessionGuard)
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @Get('my')
  @ApiOperation({
    summary: 'Get recommendations assigned to current user',
    description:
      'Returns recommendations linked to current user with service/document details, matching rationale and dependency graph.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user recommendations',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyRecommendations(@CurrentUser() user: CurrentUserData) {
    return this.recommendationsService.findAssignedToUserList(user.id);
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
  async getUserRecommendationsForAdmin(
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.recommendationsService.findAssignedToUserForAdmin(userId);
  }

  @Post('admin/generate')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Generate client recommendations from diagnostics (admin)',
  })
  @ApiResponse({ status: 201, description: 'Recommendations generated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async generateForAdmin(@Body() dto: GenerateRecommendationsDto) {
    return this.recommendationsService.generateForUser(dto);
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminRecommendationDto,
  ) {
    return this.recommendationsService.updateForAdmin(id, dto);
  }

  @Patch('admin/:id/dependencies')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update recommendation dependency graph (admin)',
  })
  @ApiParam({ name: 'id', description: 'Recommendation ID' })
  @ApiResponse({ status: 200, description: 'Dependencies updated' })
  @ApiResponse({ status: 400, description: 'Invalid dependency graph' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Recommendation not found' })
  async updateDependenciesForAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecommendationDependenciesDto,
  ) {
    return this.recommendationsService.updateDependenciesForAdmin(
      id,
      dto.dependencyIds,
    );
  }

  @Delete('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete recommendation (admin)',
  })
  @ApiParam({ name: 'id', description: 'Recommendation ID' })
  @ApiResponse({ status: 204, description: 'Recommendation deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Recommendation not found' })
  async removeForAdmin(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.recommendationsService.removeForAdmin(id);
  }
}
