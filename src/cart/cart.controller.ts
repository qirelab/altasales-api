import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type CurrentUserData,
} from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartService } from './cart.service';

@ApiTags('cart')
@ApiCookieAuth('session')
@UseGuards(SessionGuard)
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user active cart' })
  getMyCart(@CurrentUser() user: CurrentUserData) {
    return this.cartService.getMyCart(user.id);
  }

  @Post('items')
  @ApiOperation({ summary: 'Add service to current user cart' })
  addItem(@CurrentUser() user: CurrentUserData, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Patch('items/:serviceId')
  @ApiOperation({ summary: 'Update cart item quantity by service ID' })
  updateItemQuantity(
    @CurrentUser() user: CurrentUserData,
    @Param('serviceId') serviceId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItemQuantity(user.id, serviceId, dto);
  }

  @Delete('items/:serviceId')
  @ApiOperation({ summary: 'Remove cart item by service ID' })
  removeItem(
    @CurrentUser() user: CurrentUserData,
    @Param('serviceId') serviceId: string,
  ) {
    return this.cartService.removeItem(user.id, serviceId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear current user cart' })
  clear(@CurrentUser() user: CurrentUserData) {
    return this.cartService.clear(user.id);
  }
}
