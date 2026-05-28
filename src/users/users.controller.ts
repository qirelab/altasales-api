import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiCookieAuth } from '@nestjs/swagger';
import { SessionGuard } from '../auth/guards/session.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BalanceService } from '../balance-transactions/balance.service';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { GetAdminUsersQueryDto } from './dto/get-admin-users-query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { UserRole } from './entities/user-role.enum';
import { UserBalanceBreakdownResponseDto } from './dto/user-balance-breakdown.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly balanceService: BalanceService,
  ) { }

  @Get('profile')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Get current user profile (email, phone, name, lastName, balance)' })
  @ApiCookieAuth('session')
  @ApiResponse({ status: 200, description: 'User profile' })
  @ApiResponse({ status: 401, description: 'Unauthorized - session cookie required' })
  async getProfile(@CurrentUser() user: CurrentUserData) {
    const { profile, stats } = await this.usersService.getProfile(user.id);
    return { user: profile, stats };
  }

  @Get('profile/balance')
  @UseGuards(SessionGuard)
  @ApiOperation({
    summary: 'Баланс текущего пользователя с разбивкой основной / подарочный',
  })
  @ApiCookieAuth('session')
  @ApiResponse({ status: 200, description: 'Актуальный баланс', type: UserBalanceBreakdownResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyBalanceBreakdown(@CurrentUser() user: CurrentUserData): Promise<UserBalanceBreakdownResponseDto> {
    return this.balanceService.getBalanceBreakdown(user.id);
  }

  @Patch('profile')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Update current user profile' })
  @ApiCookieAuth('session')
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updateProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    await this.usersService.update(user.id, updateUserDto);
    const { profile, stats } = await this.usersService.getProfile(user.id);
    return { user: profile, stats };
  }

  @Patch('profile/gift-intro-seen')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Mark gift balance intro modal as seen for current user' })
  @ApiCookieAuth('session')
  @ApiResponse({ status: 200, description: 'Flag updated, profile returned' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markGiftIntroSeen(@CurrentUser() user: CurrentUserData) {
    await this.usersService.markGiftIntroSeen(user.id);
    const { profile, stats } = await this.usersService.getProfile(user.id);
    return { user: profile, stats };
  }

  @Post()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new user' })
  @ApiResponse({ status: 201, description: 'User successfully created', type: User })
  @ApiResponse({ status: 409, description: 'User with this email already exists' })
  async create(@Body() createUserDto: CreateUserDto): Promise<User> {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all users' })
  @ApiResponse({ status: 200, description: 'List of all users', type: [User] })
  async findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Get('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get admin users list (paginated, with search by name/lastName/email/phone)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list with name, lastName, email, phoneNumber, ordersCount, registrationDate',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAllForAdmin(@Query() query: GetAdminUsersQueryDto) {
    return this.usersService.findAllForAdmin(query);
  }

  @Get('admin/:id/balance')
  // @UseGuards(SessionGuard, RolesGuard)
  // @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Баланс пользователя по ID (админ) с разбивкой основной / подарочный',
  })
  @ApiCookieAuth('session')
  @ApiParam({ name: 'id', description: 'User ID (UUID)' })
  @ApiResponse({ status: 200, description: 'Актуальный баланс', type: UserBalanceBreakdownResponseDto })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserBalanceBreakdownForAdmin(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserBalanceBreakdownResponseDto> {
    return this.balanceService.getBalanceBreakdown(id);
  }

  @Get('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      'Get user details for admin with stats and full orders list',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description:
      'User info (name, lastName, email, phone, registration date), stats and all user orders',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOneForAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOneForAdmin(id);
  }

  @Get(':id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User found', type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<User> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User successfully updated', type: User })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User with this email already exists' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() updateUserDto: UpdateUserDto): Promise<User> {
    return this.usersService.update(id, updateUserDto);
  }

  @Patch('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update user by ID for admin' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'User successfully updated', type: User })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User with this email already exists' })
  async updateForAdmin(@Param('id', ParseUUIDPipe) id: string, @Body() updateUserDto: UpdateUserDto): Promise<User> {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete user' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 204, description: 'User successfully deleted' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.usersService.remove(id);
  }

  @Delete('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete user by ID for admin' })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiResponse({ status: 204, description: 'User successfully deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async removeForAdmin(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.usersService.remove(id);
  }
}
