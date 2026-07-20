import { Controller, Post, Body, Res, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiCookieAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { SessionGuard } from '../auth/guards/session.guard';
import { CurrentUser, type CurrentUserData } from '../auth/decorators/current-user.decorator';
import { PaymentService } from './payment.service';
import { CreateTopUpPaymentDto } from './dto/create-topup-payment.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) { }

  @Post('robokassa/topup/create')
  @UseGuards(SessionGuard)
  @ApiCookieAuth('session')
  @ApiOperation({
    summary: 'Создать платеж на пополнение внутреннего баланса',
    description:
      'Формирует Robokassa-параметры для пополнения. Баланс будет зачислен только после подтвержденного Result callback.',
  })
  @ApiResponse({ status: 201, description: 'Платеж на пополнение создан' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Validation or business error' })
  async createTopUpPayment(@Body() dto: CreateTopUpPaymentDto, @CurrentUser() user: CurrentUserData) {
    return this.paymentService.createTopUpPayment(user.id, dto);
  }

  @Post('robokassa/result')
  @ApiOperation({
    summary: 'Robokassa Result URL (callback)',
    description:
      'Set this URL as Result URL in Robokassa merchant panel.',
  })
  @ApiResponse({ status: 200, description: 'OK{InvId} on success' })
  async robokassaResult(@Body() body: Record<string, string>, @Res() res: Response) {
    const { response } = await this.paymentService.handleResultCallback(body);
    if (response.startsWith('OK')) {
      res.status(HttpStatus.OK).contentType('text/plain').send(response);
      return;
    }
    res.status(HttpStatus.BAD_REQUEST).contentType('text/plain').send(response);
  }

  @Post('robokassa/fail')
  @ApiOperation({
    summary: 'Robokassa Fail URL',
    description:
      'Помечает платеж как неуспешный, если оплата была отменена или не завершена.',
  })
  @ApiResponse({ status: 200, description: 'OK{InvId} when status handled' })
  async robokassaFail(@Body() body: Record<string, string>, @Res() res: Response) {
    const { response } = await this.paymentService.handleFailCallback(body);
    if (response.startsWith('OK')) {
      res.status(HttpStatus.OK).contentType('text/plain').send(response);
      return;
    }
    res.status(HttpStatus.BAD_REQUEST).contentType('text/plain').send(response);
  }
}
