import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RobokassaService } from './robokassa.service';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly robokassaService: RobokassaService,
  ) {}

  async create(dto: CreatePaymentDto): Promise<{ paymentUrl: string; params: Record<string, string | number> }> {
    let invId = dto.invId;
    if (invId == null) {
      const last = await this.paymentRepository
        .createQueryBuilder('p')
        .select('MAX(p.invId)', 'max')
        .getRawOne<{ max: number | null }>();
      invId = (last?.max ?? 0) + 1;
    } else {
      const existing = await this.paymentRepository.findOne({ where: { invId } });
      if (existing) {
        throw new BadRequestException(`Payment with InvId ${invId} already exists`);
      }
    }

    const payment = this.paymentRepository.create({
      invId,
      outSum: dto.outSum,
      description: dto.description,
      status: PaymentStatus.Pending,
    });
    await this.paymentRepository.save(payment);

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
    } catch {
      return { response: `error: order not found` };
    }

    return { response: `OK${invId}` };
  }
}
