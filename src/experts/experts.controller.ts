import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { ExpertCheckoutDto } from './dto/expert-checkout.dto';
import { ExpertsService } from './experts.service';

@ApiTags('experts')
@Controller('experts')
export class ExpertsController {
  constructor(private readonly expertsService: ExpertsService) { }

  @Get('positions')
  @ApiOperation({ summary: 'List expert positions (role groups)' })
  @ApiResponse({ status: 200, description: 'Four positions with name and description' })
  async listPositions() {
    return this.expertsService.findAllPositions();
  }

  @Get('positions/:id')
  @ApiOperation({ summary: 'Expert position details with offerings and executors' })
  @ApiParam({ name: 'id', description: 'Position ID' })
  @ApiResponse({ status: 200, description: 'Position with default-priced offerings and executors' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async getPosition(@Param('id', ParseUUIDPipe) id: string) {
    return this.expertsService.findPositionById(id);
  }

  @Post('checkout')
  @UseGuards(SessionGuard)
  @ApiOperation({
    summary: 'Checkout expert services for a position and executor',
    description:
      'Creates an order; total equals the sum of selected offering default prices (executor does not affect price).',
  })
  @ApiResponse({ status: 201, description: 'Order created and payment flow started/completed' })
  @ApiResponse({ status: 400, description: 'Validation or business error' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 409, description: 'Executor not assigned to position' })
  async checkout(@Body() dto: ExpertCheckoutDto, @CurrentUser() user: CurrentUserData) {
    return this.expertsService.checkout(dto, user.id);
  }
}
