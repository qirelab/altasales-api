import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { ServicesService } from './services.service';
import { CreateAdminContractorDto } from './dto/create-admin-contractor.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { GetAdminContractorsQueryDto } from './dto/get-admin-contractors-query.dto';
import { GetAdminServicesQueryDto } from './dto/get-admin-services-query.dto';
import { UpdateAdminContractorDto } from './dto/update-admin-contractor.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { GetServicesQueryDto } from './dto/get-services-query.dto';
import { Service } from './entities/service.entity';
import { ServicePackage } from '../packages/entities/package.entity';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) { }

  @Get()
  @ApiOperation({
    summary: 'Get all services',
    description: 'Returns packages/services; filters by categoryIds; category content is returned only for a single selected category',
  })
  @ApiResponse({ status: 200, description: 'Packages and services list with optional category content' })
  async findAll(@Query() query: GetServicesQueryDto): Promise<{
    packages: ServicePackage[];
    services: Service[];
    categoryContent: {
      id: string;
      name: string;
      description: string | null;
      faqs: Array<{
        id: string;
        question: string;
        answer: string;
      }>;
    } | null;
  }> {
    return this.servicesService.findAll(query);
  }

  @Get('skills')
  @ApiOperation({ summary: 'Get all unique skills across services' })
  @ApiResponse({ status: 200, description: 'List of unique skills', type: [String] })
  async getSkills(): Promise<string[]> {
    return this.servicesService.getAllSkills();
  }

  @Get('expert/profile')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.EXPERT)
  @ApiOperation({ summary: 'Get expert personal cabinet data' })
  @ApiResponse({ status: 200, description: 'Expert profile with stats and orders' })
  async findExpertProfile(@CurrentUser() user: CurrentUserData) {
    return this.servicesService.findExpertProfile(user.id);
  }

  @Post('admin/contractors')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create contractor (old scenario via service)' })
  @ApiResponse({ status: 201, description: 'Contractor created', type: Service })
  async createContractor(@Body() dto: CreateAdminContractorDto): Promise<Service> {
    return this.servicesService.createContractor(dto);
  }

  @Get('admin/contractors')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get contractors list for admin (paginated, with search)' })
  @ApiResponse({ status: 200, description: 'Paginated contractors list' })
  async findAllContractorsForAdmin(@Query() query: GetAdminContractorsQueryDto) {
    return this.servicesService.findAllContractorsForAdmin(query);
  }

  @Get('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get services list for admin (paginated, with search)' })
  @ApiResponse({ status: 200, description: 'Paginated services list with orders count' })
  async findAllServicesForAdmin(@Query() query: GetAdminServicesQueryDto) {
    return this.servicesService.findAllServicesForAdmin(query);
  }

  @Post('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create service (admin)' })
  @ApiResponse({ status: 201, description: 'Service created', type: Service })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async createForAdmin(@Body() createServiceDto: CreateServiceDto): Promise<Service> {
    return this.servicesService.create(createServiceDto);
  }

  @Get('admin/contractors/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get contractor by ID for admin (old scenario)' })
  @ApiParam({ name: 'id', description: 'Contractor ID' })
  @ApiResponse({ status: 200, description: 'Contractor found with orders' })
  @ApiResponse({ status: 404, description: 'Contractor not found' })
  async findOneContractorForAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.findOneContractorForAdmin(id);
  }

  @Get('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get service by ID for admin with stats and orders' })
  @ApiParam({ name: 'id', description: 'Service ID' })
  @ApiResponse({ status: 200, description: 'Service found with stats and orders' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async findOneServiceForAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.servicesService.findOneServiceForAdmin(id);
  }

  @Patch('admin/contractors/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update contractor by ID for admin (old scenario)' })
  @ApiParam({ name: 'id', description: 'Contractor ID' })
  @ApiResponse({ status: 200, description: 'Contractor updated', type: Service })
  @ApiResponse({ status: 404, description: 'Contractor not found' })
  async updateContractorForAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminContractorDto,
  ): Promise<Service> {
    return this.servicesService.updateContractorForAdmin(id, dto);
  }

  @Delete('admin/contractors/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete contractor by ID for admin (old scenario)' })
  @ApiParam({ name: 'id', description: 'Contractor ID' })
  @ApiResponse({ status: 204, description: 'Contractor deleted' })
  @ApiResponse({ status: 404, description: 'Contractor not found' })
  async removeContractorForAdmin(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.servicesService.removeContractorForAdmin(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get service by ID' })
  @ApiParam({ name: 'id', description: 'Service ID' })
  @ApiResponse({ status: 200, description: 'Service found', type: Service })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Service> {
    return this.servicesService.findOne(id);
  }

  @Patch('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update service by ID (admin)' })
  @ApiParam({ name: 'id', description: 'Service ID' })
  @ApiResponse({ status: 200, description: 'Service updated', type: Service })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async updateForAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateServiceDto: UpdateServiceDto,
  ): Promise<Service> {
    return this.servicesService.update(id, updateServiceDto);
  }

  @Delete('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete service by ID (admin)' })
  @ApiParam({ name: 'id', description: 'Service ID' })
  @ApiResponse({ status: 204, description: 'Service deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async removeForAdmin(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.servicesService.remove(id);
  }
}
