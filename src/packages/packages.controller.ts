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
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreatePackageDto } from './dto/create-package.dto';
import { GetAdminPackagesQueryDto } from './dto/get-admin-packages-query.dto';
import { SetPackageVisibilityDto } from './dto/set-package-visibility.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { ServicePackage } from './entities/package.entity';
import { PackagesService } from './packages.service';

@ApiTags('packages')
@Controller('packages')
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) { }

  @Get('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get packages list for admin (paginated, with search and orders count)' })
  @ApiResponse({ status: 200, description: 'Paginated packages list with orders count' })
  async findAllForAdmin(@Query() query: GetAdminPackagesQueryDto) {
    return this.packagesService.findAllPackagesForAdmin(query);
  }

  @Get('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get package by ID for admin with orders count and related orders' })
  @ApiParam({ name: 'id', description: 'Package ID' })
  @ApiResponse({ status: 200, description: 'Package found with stats and orders' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async findOneForAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.packagesService.findOnePackageForAdmin(id);
  }

  @Post('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a service package (admin only)' })
  @ApiResponse({ status: 201, description: 'Package created', type: ServicePackage })
  async createForAdmin(@Body() createPackageDto: CreatePackageDto): Promise<ServicePackage> {
    return this.packagesService.create(createPackageDto);
  }

  @Patch('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update service package (admin only)' })
  @ApiParam({ name: 'id', description: 'Package ID' })
  @ApiResponse({ status: 200, description: 'Package updated', type: ServicePackage })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async updateForAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePackageDto: UpdatePackageDto,
  ): Promise<ServicePackage> {
    return this.packagesService.update(id, updatePackageDto);
  }

  @Patch('admin/:id/visibility')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Set package visibility (admin)' })
  @ApiParam({ name: 'id', description: 'Package ID' })
  @ApiResponse({ status: 200, description: 'Package visibility updated', type: ServicePackage })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async setVisibilityForAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPackageVisibilityDto,
  ): Promise<ServicePackage> {
    return this.packagesService.setVisibilityForAdmin(id, dto.isHidden);
  }

  @Delete('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete service package (admin only)' })
  @ApiParam({ name: 'id', description: 'Package ID' })
  @ApiResponse({ status: 204, description: 'Package deleted' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async removeForAdmin(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.packagesService.remove(id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all service packages' })
  @ApiResponse({ status: 200, description: 'List of service packages', type: [ServicePackage] })
  async findAll(): Promise<ServicePackage[]> {
    return this.packagesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get service package by ID' })
  @ApiParam({ name: 'id', description: 'Package ID' })
  @ApiResponse({ status: 200, description: 'Package found', type: ServicePackage })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ServicePackage> {
    return this.packagesService.findOne(id);
  }
}
