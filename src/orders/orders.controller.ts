import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Param,
  Delete,
  Patch,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { CheckoutDto } from './dto/checkout.dto';
import { GetAdminOrdersQueryDto } from './dto/get-admin-orders-query.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { UpdateContractorChatAccessDto } from './dto/update-contractor-chat-access.dto';
import { UpdateOrderItemStatusDto } from './dto/update-order-item-status.dto';
import { UpdateOrderItemSubItemStatusDto } from './dto/update-order-item-sub-item-status.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
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

  @Get('expert')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.EXPERT)
  @ApiOperation({ summary: 'Get orders assigned to current expert' })
  @ApiResponse({ status: 200, description: 'Paginated list of expert-assigned orders with items' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async getExpertOrders(@CurrentUser() user: CurrentUserData, @Query() query: GetOrdersQueryDto) {
    return this.ordersService.findAssignedToExpert(user.id, query);
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
  async getAdminOrderById(@Param('id', ParseUUIDPipe) id: string) {
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
  async deleteAdminOrder(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.ordersService.removeForAdmin(id);
  }

  @Patch('admin/:id/contractor-chat-access')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update contractor chat access for order (admin)' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 200, description: 'Order updated with contractor chat access flag' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async updateContractorChatAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContractorChatAccessDto,
  ) {
    return this.ordersService.updateContractorChatAccessForAdmin(id, dto);
  }

  @Patch('admin/:id/status')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update order status (admin)' })
  @ApiParam({ name: 'id', description: 'Order ID' })
  @ApiResponse({ status: 200, description: 'Order status updated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async updateOrderStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatusForAdmin(id, dto);
  }

  @Patch('admin/items/:itemId/status')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update order item status (admin)' })
  @ApiParam({ name: 'itemId', description: 'Order item ID' })
  @ApiResponse({ status: 200, description: 'Order item status updated' })
  @ApiResponse({ status: 400, description: 'Invalid status update for package item' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order item not found' })
  async updateOrderItemStatus(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateOrderItemStatusDto,
  ) {
    return this.ordersService.updateItemStatusForAdmin(itemId, dto.status);
  }

  @Patch('admin/items/:itemId/sub-items/:subItemId/status')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update package sub-item status (admin)' })
  @ApiParam({ name: 'itemId', description: 'Order package item ID' })
  @ApiParam({ name: 'subItemId', description: 'Order package sub-item ID' })
  @ApiResponse({ status: 200, description: 'Order package sub-item status updated' })
  @ApiResponse({ status: 400, description: 'Order item is not a package' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Order item or sub-item not found' })
  async updateOrderItemSubItemStatus(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('subItemId', ParseUUIDPipe) subItemId: string,
    @Body() dto: UpdateOrderItemSubItemStatusDto,
  ) {
    return this.ordersService.updateSubItemStatus(itemId, subItemId, dto.status);
  }

  @Post('checkout')
  @ApiOperation({
    summary: 'Checkout с выбором способа оплаты',
    description:
      'Создает заказ(ы) и обрабатывает оплату: Robokassa (paymentUrl/params) или баланс. ' +
      'В items[] — услуга (serviceId), пакет (packageId) или экспертная позиция ' +
      '(expertPositionId, executorUserId, offeringIds).',
  })
  @ApiResponse({ status: 201, description: 'Order created and payment flow started/completed' })
  @ApiResponse({ status: 400, description: 'Validation or business error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async checkout(@Body() dto: CheckoutDto, @CurrentUser() user: CurrentUserData) {
    return this.ordersService.checkout(dto, user.id);
  }
}
