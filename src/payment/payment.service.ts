import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RobokassaService } from './robokassa.service';
import { Order } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/entities/order-status.enum';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly robokassaService: RobokassaService,
  ) { }

  async createWithManager(
    dto: CreatePaymentDto,
    manager: EntityManager,
  ): Promise<{ paymentUrl: string; params: Record<string, string | number> }> {
    const paymentRepo = manager.getRepository(Payment);

    let invId = dto.invId;
    if (invId == null) {
      if (dto.orderId != null) {
        invId = dto.orderId;
      } else {
        const last = await paymentRepo
          .createQueryBuilder('p')
          .select('MAX(p.invId)', 'max')
          .getRawOne<{ max: number | null }>();
        invId = (last?.max ?? 0) + 1;
      }
    } else {
      const existing = await paymentRepo.findOne({ where: { invId } });
      if (existing) {
        throw new BadRequestException(`Payment with InvId ${invId} already exists`);
      }
    }

    const payment = paymentRepo.create({
      invId,
      orderId: dto.orderId ?? null,
      outSum: dto.outSum,
      description: dto.description,
      status: PaymentStatus.Pending,
    });
    await paymentRepo.save(payment);

    const params = this.robokassaService.buildPaymentParams(
      Number(dto.outSum),
      invId,
      dto.description,
    );
    const paymentUrl = params.paymentUrl;
    const formParams = {
      MerchantLogin: params.MerchantLogin,
      OutSum: params.OutSum,
      InvId: params.InvId,
      Description: params.Description,
      SignatureValue: params.SignatureValue,
      IsTest: params.IsTest,
    };
    return { paymentUrl, params: formParams };
  }

  async findByInvId(invId: number): Promise<Payment> {
    const payment = await this.paymentRepository.findOne({ where: { invId } });
    if (!payment) {
      throw new NotFoundException(`Payment with InvId ${invId} not found`);
    }
    return payment;
  }

  async markPaid(invId: number): Promise<void> {
    const payment = await this.findByInvId(invId);
    payment.status = PaymentStatus.Paid;
    await this.paymentRepository.save(payment);
  }

  async handleResultCallback(body: Record<string, string>): Promise<{ response: string }> {
    const outSum = body.OutSum;
    const invId = body.InvId;
    const signatureValue = body.SignatureValue;

    if (!outSum || !invId || !signatureValue) {
      return { response: `bad request: missing OutSum, InvId or SignatureValue` };
    }

    const shpParams = this.robokassaService.extractShpParams(body);
    const isValid = this.robokassaService.verifyResultSignature(
      outSum,
      invId,
      signatureValue,
      Object.keys(shpParams).length > 0 ? shpParams : undefined,
    );

    if (!isValid) {
      return { response: `bad signature` };
    }

    const invIdNum = parseInt(invId, 10);
    if (Number.isNaN(invIdNum)) {
      return { response: `bad InvId` };
    }

    try {
      await this.markPaid(invIdNum);
      const payment = await this.paymentRepository.findOne({ where: { invId: invIdNum } });
      if (payment?.orderId != null) {
        await this.orderRepository.update(
          { id: payment.orderId },
          { status: OrderStatus.InProgress },
        );
      }
    } catch {
      return { response: `error: order not found` };
    }

    return { response: `OK${invId}` };
  }
}
