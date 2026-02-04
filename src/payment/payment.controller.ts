import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { PaymentService } from './payment.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) { }

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
}
