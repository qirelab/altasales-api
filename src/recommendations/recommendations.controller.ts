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
import { GenerateMyRecommendationsDto } from './dto/generate-my-recommendations.dto';
import { GenerateRecommendationsDto } from './dto/generate-recommendations.dto';
import { UpdateAdminRecommendationDto } from './dto/update-admin-recommendation.dto';
import { UpdateRecommendationDependenciesDto } from './dto/update-recommendation-dependencies.dto';
import { UpdateUserRecommendationDto } from './dto/update-user-recommendation.dto';
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
      'Returns recommendations linked to current user with service, document, or package details, priority and dependency graph.',
  })
  @ApiResponse({ status: 200, description: 'List of user recommendations' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyRecommendations(@CurrentUser() user: CurrentUserData) {
    return this.recommendationsService.findAssignedToUserList(user.id);
  }

  @Post('seen')
  @ApiOperation({ summary: 'Mark recommendation notifications as seen' })
  @ApiResponse({ status: 200, description: 'Notifications marked as seen' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markSeen(@CurrentUser() user: CurrentUserData) {
    return this.recommendationsService.markRecommendationsSeen(user.id);
  }

  @Patch('my/:id')
  @ApiOperation({
    summary: 'Update current user recommendation',
    description:
      'Allows the current user to update the lifecycle status of their own recommendation.',
  })
  @ApiParam({ name: 'id', description: 'Recommendation ID' })
  @ApiResponse({ status: 200, description: 'Recommendation updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Recommendation not found' })
  async updateMyRecommendation(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRecommendationDto,
  ) {
    return this.recommendationsService.updateForUser(user.id, id, dto);
  }

  @Post('my/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark current user recommendation as completed' })
  @ApiParam({ name: 'id', description: 'Recommendation ID' })
  @ApiResponse({ status: 200, description: 'Recommendation completed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Recommendation not found' })
  async completeMyRecommendation(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recommendationsService.completeForUser(user.id, id);
  }

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start recommendation generation for current user',
    description:
      'Accepts onboarding/client diagnostics, starts generation and returns a job for polling.',
  })
  @ApiResponse({ status: 202, description: 'Recommendation generation started' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async generateForCurrentUser(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: GenerateMyRecommendationsDto,
  ) {
    return this.recommendationsService.startGenerationForUser(user.id, dto);
  }

  @Get('generation-jobs/:id')
  @ApiOperation({ summary: 'Get current user recommendation generation job' })
  @ApiParam({ name: 'id', description: 'Recommendation generation job ID' })
  @ApiResponse({ status: 200, description: 'Recommendation generation job' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Generation job not found' })
  async getMyGenerationJob(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.recommendationsService.findGenerationJobForUser(user.id, id);
  }

  @Get('admin/user/:userId')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get recommendations assigned to specific user (admin)' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'List of user recommendations for admin panel' })
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
  @ApiOperation({ summary: 'Generate client recommendations from diagnostics (admin)' })
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
    description: 'Provide exactly one of serviceId (service/document) or packageId.',
  })
  @ApiResponse({ status: 201, description: 'Recommendation created' })
  @ApiResponse({ status: 400, description: 'Invalid recommendation payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'This service or package is already recommended to this user' })
  @ApiResponse({ status: 404, description: 'User, service, or package not found' })
  async createForAdmin(@Body() dto: CreateAdminRecommendationDto) {
    return this.recommendationsService.createForAdmin(dto);
  }

  @Patch('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update recommendation (admin)',
    description: 'To change the recommended item, send only serviceId or only packageId (not both).',
  })
  @ApiParam({ name: 'id', description: 'Recommendation ID' })
  @ApiResponse({ status: 200, description: 'Recommendation updated' })
  @ApiResponse({ status: 400, description: 'Invalid recommendation payload' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 409, description: 'This service or package is already recommended to this user' })
  @ApiResponse({ status: 404, description: 'Recommendation, service, package, or order not found' })
  async updateForAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminRecommendationDto,
  ) {
    return this.recommendationsService.updateForAdmin(id, dto);
  }

  @Patch('admin/:id/dependencies')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update recommendation dependency graph (admin)' })
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
    return this.recommendationsService.updateDependenciesForAdmin(id, dto.dependencyIds);
  }

  @Delete('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete recommendation (admin)' })
  @ApiParam({ name: 'id', description: 'Recommendation ID' })
  @ApiResponse({ status: 204, description: 'Recommendation deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Recommendation not found' })
  async removeForAdmin(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.recommendationsService.removeForAdmin(id);
  }
}
