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
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import {
  CreateAdminExpertMemberDto,
  UpdateAdminExpertMemberDto,
} from './dto/admin-expert-member.dto';
import { ExpertGroupsQueryDto } from './dto/expert-groups-query.dto';
import { ExpertsService } from './experts.service';

@ApiTags('admin-experts')
@Controller('experts/admin')
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminExpertsController {
  constructor(private readonly expertsService: ExpertsService) {}

  @Get('members')
  @ApiOperation({ summary: 'List expert users with group assignments' })
  getMembers(@Query() query: ExpertGroupsQueryDto) {
    return this.expertsService.getAdminExpertMembers(query);
  }

  @Get('members/:userId')
  @ApiOperation({ summary: 'Get expert user details with group and prices' })
  @ApiParam({ name: 'userId', description: 'Expert user ID' })
  getMemberById(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.expertsService.getAdminExpertMemberById(userId);
  }

  @Post('members')
  @ApiOperation({ summary: 'Create expert user (without legacy contractor row)' })
  createMember(@Body() dto: CreateAdminExpertMemberDto) {
    return this.expertsService.createAdminExpertMember(dto);
  }

  @Patch('members/:userId')
  @ApiOperation({ summary: 'Update expert user profile' })
  @ApiParam({ name: 'userId', description: 'Expert user ID' })
  updateMember(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateAdminExpertMemberDto,
  ) {
    return this.expertsService.updateAdminExpertMember(userId, dto);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete expert user and detach from groups' })
  @ApiParam({ name: 'userId', description: 'Expert user ID' })
  async removeMember(@Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    await this.expertsService.removeAdminExpertMember(userId);
  }
}
