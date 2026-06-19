import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { PublicExpertProfileDto } from './dto/public-expert-profile.dto';
import { UpdateExpertProfileDto } from './dto/update-expert-profile.dto';
import { ExpertsService } from './experts.service';

@ApiTags('experts')
@Controller('experts')
export class ExpertsController {
  constructor(private readonly expertsService: ExpertsService) { }

  @Get('positions')
  @ApiOperation({ summary: 'List expert positions (role groups)' })
  @ApiResponse({ status: 200, description: 'Four positions with name and description' })
  async listPositions() {
    return this.expertsService.findAllPositions();
  }

  @Get('positions/:id')
  @ApiOperation({ summary: 'Expert position details with offerings and executors' })
  @ApiParam({ name: 'id', description: 'Position ID' })
  @ApiResponse({ status: 200, description: 'Position with offerings and executor-specific prices' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async getPosition(@Param('id', ParseUUIDPipe) id: string) {
    return this.expertsService.findPositionById(id);
  }

  @Get('members/:userId')
  @ApiOperation({ summary: 'Public expert profile by user ID' })
  @ApiParam({ name: 'userId', description: 'Expert user ID' })
  @ApiResponse({ status: 200, description: 'Public expert profile', type: PublicExpertProfileDto })
  @ApiResponse({ status: 404, description: 'Expert not found' })
  async getMemberProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.expertsService.findPublicExpertProfile(userId);
  }

  @Patch('profile')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.EXPERT)
  @ApiOperation({ summary: 'Update own expert profile fields' })
  @ApiResponse({ status: 200, description: 'Updated public expert profile', type: PublicExpertProfileDto })
  async updateMyProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdateExpertProfileDto,
  ) {
    return this.expertsService.updateExpertProfile(user.id, dto);
  }
}
