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
import { CategoriesService } from './categories.service';
import { CreateAdminCategoryDto } from './dto/create-admin-category.dto';
import { GetAdminCategoriesQueryDto } from './dto/get-admin-categories-query.dto';
import { UpdateAdminCategoryDto } from './dto/update-admin-category.dto';
import { Category } from './entities/category.entity';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) { }

  @Get('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get categories list for admin (paginated, with search)' })
  @ApiResponse({ status: 200, description: 'Paginated categories list with FAQ' })
  async findAllForAdmin(@Query() query: GetAdminCategoriesQueryDto) {
    return this.categoriesService.findAllForAdmin(query);
  }

  @Get('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get category by ID for admin (with FAQ)' })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Category with FAQ', type: Category })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findOneForAdmin(@Param('id', ParseUUIDPipe) id: string): Promise<Category> {
    return this.categoriesService.findOneForAdmin(id);
  }

  @Post('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create category (admin)' })
  @ApiResponse({ status: 201, description: 'Category created', type: Category })
  @ApiResponse({ status: 409, description: 'Name or slug already exists' })
  async createForAdmin(@Body() dto: CreateAdminCategoryDto): Promise<Category> {
    return this.categoriesService.createForAdmin(dto);
  }

  @Patch('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Update category (admin)',
    description: 'Pass faqs array to replace all FAQ items for the category',
  })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 200, description: 'Category updated', type: Category })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Name or slug already exists' })
  async updateForAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminCategoryDto,
  ): Promise<Category> {
    return this.categoriesService.updateForAdmin(id, dto);
  }

  @Delete('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete category (admin)',
    description: 'Unlinks category from services and packages (categoryId becomes null)',
  })
  @ApiParam({ name: 'id', description: 'Category ID' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async removeForAdmin(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.categoriesService.removeForAdmin(id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all categories (for filter list)' })
  @ApiResponse({ status: 200, description: 'List of all categories', type: [Category] })
  async findAll(): Promise<Category[]> {
    return this.categoriesService.findAll();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get category content by slug with FAQ relation' })
  @ApiParam({ name: 'slug', description: 'Category slug' })
  @ApiResponse({ status: 200, description: 'Category with content and FAQ', type: Category })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findBySlug(@Param('slug') slug: string): Promise<Category> {
    return this.categoriesService.findBySlug(slug);
  }
}
