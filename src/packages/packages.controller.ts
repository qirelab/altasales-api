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
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { ServicePackage } from './entities/package.entity';
import { PackagesService } from './packages.service';

@ApiTags('packages')
@Controller('packages')
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) { }

  @Post()
  @ApiOperation({ summary: 'Create a service package' })
  @ApiResponse({ status: 201, description: 'Package created', type: ServicePackage })
  async create(@Body() createPackageDto: CreatePackageDto): Promise<ServicePackage> {
    return this.packagesService.create(createPackageDto);
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

  @Patch(':id')
  @ApiOperation({ summary: 'Update service package' })
  @ApiParam({ name: 'id', description: 'Package ID' })
  @ApiResponse({ status: 200, description: 'Package updated', type: ServicePackage })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePackageDto: UpdatePackageDto,
  ): Promise<ServicePackage> {
    return this.packagesService.update(id, updatePackageDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete service package' })
  @ApiParam({ name: 'id', description: 'Package ID' })
  @ApiResponse({ status: 204, description: 'Package deleted' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.packagesService.remove(id);
  }
}
