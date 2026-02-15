import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { CheckoutDto } from './dto/checkout.dto';
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
