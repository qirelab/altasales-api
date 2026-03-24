                                     import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { GetAdminOrdersQueryDto } from './dto/get-admin-orders-query.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
@UseGuards(SessionGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) { }

  @Get()
  @ApiOperation({ summary: 'Get current user orders (paginated, optional status filter)' })
  @ApiResponse({ status: 200, description: 'Paginated list of user orders with items' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyOrders(@CurrentUser() user: CurrentUserData, @Query() query: GetOrdersQueryDto) {
    return this.ordersService.findByUserId(user.id, query);
  }

  @Get('admin')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Get all orders for admin (paginated, with search)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Paginated list with order id, items count, client name, date, amount and status',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getAdminOrders(@Query() query: GetAdminOrdersQueryDto) {
    return this.ordersService.findAllForAdmin(query);
  }

  @Get('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get order details by id for admin' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 200, description: 'Order details with items' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async getAdminOrderById(@Param('id') id: string) {
    return this.ordersService.findOneForAdmin(id);
  }

  @Delete('admin/:id')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete order by id for admin' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 204, description: 'Order deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async deleteAdminOrder(@Param('id') id: string): Promise<void> {
    return this.ordersService.removeForAdmin(id);
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Checkout (create order + payment, one request)',
    description:
      'Creates order with items, creates Robokassa payment. Returns orderId, paymentUrl and params for redirect.',
  })
  @ApiResponse({ status: 201, description: 'Order and payment created' })
  @ApiResponse({ status: 400, description: 'Validation or business error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async checkout(@Body() dto: CheckoutDto, @CurrentUser() user: CurrentUserData) {
    return this.ordersService.checkout(dto, user.id);
  }
}
