import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
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
  @ApiOperation({ summary: 'Add service or package to current user cart' })
  addItem(@CurrentUser() user: CurrentUserData, @Body() dto: AddCartItemDto) {
    return this.cartService.addItem(user.id, dto);
  }

  @Patch('items/:itemId')
  @ApiOperation({ summary: 'Update cart item quantity by cart item ID' })
  updateItemQuantity(
    @CurrentUser() user: CurrentUserData,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItemQuantity(user.id, itemId, dto);
  }

  @Delete('items/:itemId/offerings/:offeringId')
  @ApiOperation({ summary: 'Remove expert offering from cart item' })
  removeExpertOffering(
    @CurrentUser() user: CurrentUserData,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('offeringId', ParseUUIDPipe) offeringId: string,
  ) {
    return this.cartService.removeExpertOffering(user.id, itemId, offeringId);
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: 'Remove cart item by cart item ID' })
  removeItem(
    @CurrentUser() user: CurrentUserData,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.cartService.removeItem(user.id, itemId);
  }

  @Delete()
  @ApiOperation({ summary: 'Clear current user cart' })
  clear(@CurrentUser() user: CurrentUserData) {
    return this.cartService.clear(user.id);
  }
}
