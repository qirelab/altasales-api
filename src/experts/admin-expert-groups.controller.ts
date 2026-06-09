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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { AddExpertToGroupDto } from './dto/add-expert-to-group.dto';
import {
  CreateAdminExpertGroupDto,
  UpdateAdminExpertGroupDto,
} from './dto/create-admin-expert-group.dto';
import { ExpertGroupsQueryDto } from './dto/expert-groups-query.dto';
import { CreateGroupServiceDto, UpdateGroupServiceDto } from './dto/group-service.dto';
import { BulkUpdateGroupPricesDto, SingleUpdateGroupPriceDto } from './dto/update-group-prices.dto';
import { ExpertsService } from './experts.service';

@ApiTags('admin-expert-groups')
@Controller('admin/expert-groups')
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminExpertGroupsController {
  constructor(private readonly expertsService: ExpertsService) {}

  @Get()
  @ApiOperation({ summary: 'List expert groups for admin' })
  @ApiResponse({ status: 200, description: 'Paginated expert groups list' })
  getGroups(@Query() query: ExpertGroupsQueryDto) {
    return this.expertsService.getAdminExpertGroups(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get expert group details for admin' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: 'Group details with experts, services and price matrix' })
  getGroupById(@Param('id', ParseUUIDPipe) id: string) {
    return this.expertsService.getAdminExpertGroupById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create expert group' })
  @ApiResponse({ status: 201, description: 'Group created' })
  createGroup(@Body() dto: CreateAdminExpertGroupDto) {
    return this.expertsService.createAdminExpertGroup(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update expert group' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 200, description: 'Group updated' })
  updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminExpertGroupDto,
  ) {
    return this.expertsService.updateAdminExpertGroup(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete expert group (hard/soft by business rules)' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiResponse({ status: 204, description: 'Group deleted' })
  async removeGroup(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.expertsService.removeAdminExpertGroup(id);
  }

  @Get('available-experts/all')
  @ApiOperation({ summary: 'List all EXPERT users (used when creating a new group)' })
  getAllAvailableExperts(@Query() query: ExpertGroupsQueryDto) {
    return this.expertsService.getAllExpertUsers(query);
  }

  @Get(':id/available-experts')
  @ApiOperation({ summary: 'List EXPERT users not attached to group' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  getAvailableExperts(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ExpertGroupsQueryDto,
  ) {
    return this.expertsService.getAvailableExpertsForGroup(id, query);
  }

  @Post(':id/experts')
  @ApiOperation({ summary: 'Attach expert to group' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  addExpert(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddExpertToGroupDto,
  ) {
    return this.expertsService.addExpertToGroup(id, dto);
  }

  @Delete(':id/experts/:expertId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Detach expert from group (hard/soft by business rules)' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiParam({ name: 'expertId', description: 'Expert user ID' })
  async removeExpert(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('expertId', ParseUUIDPipe) expertId: string,
  ): Promise<void> {
    await this.expertsService.removeExpertFromGroup(id, expertId);
  }

  @Post(':id/services')
  @ApiOperation({ summary: 'Create service inside expert group' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  createService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateGroupServiceDto,
  ) {
    return this.expertsService.createGroupService(id, dto);
  }

  @Patch(':id/services/:serviceId')
  @ApiOperation({ summary: 'Update group service' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiParam({ name: 'serviceId', description: 'Group service ID' })
  updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdateGroupServiceDto,
  ) {
    return this.expertsService.updateGroupService(id, serviceId, dto);
  }

  @Delete(':id/services/:serviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete group service (hard/soft by business rules)' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiParam({ name: 'serviceId', description: 'Group service ID' })
  async removeService(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ): Promise<void> {
    await this.expertsService.removeGroupService(id, serviceId);
  }

  @Patch(':id/prices')
  @ApiOperation({ summary: 'Bulk update matrix prices in group' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  updatePricesBulk(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkUpdateGroupPricesDto,
  ) {
    return this.expertsService.updateGroupPricesBulk(id, dto);
  }

  @Patch(':id/prices/:expertId/:serviceId')
  @ApiOperation({ summary: 'Update one matrix price cell' })
  @ApiParam({ name: 'id', description: 'Group ID' })
  @ApiParam({ name: 'expertId', description: 'Expert user ID' })
  @ApiParam({ name: 'serviceId', description: 'Group service ID' })
  updatePriceSingle(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('expertId', ParseUUIDPipe) expertId: string,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: SingleUpdateGroupPriceDto,
  ) {
    return this.expertsService.updateGroupPriceSingle(id, expertId, serviceId, dto);
  }
}
