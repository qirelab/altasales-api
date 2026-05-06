import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ROBOKASSA_PAYMENT_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';

@Injectable()
export class RobokassaService {
  private readonly merchantLogin: string;
  private readonly password1: string;
  private readonly password2: string;
  private readonly isTest: boolean;

  constructor(private readonly config: ConfigService) {
    this.merchantLogin = this.config.get<string>('ROBOKASSA_MERCHANT_LOGIN', '');
    this.password1 = this.config.get<string>('ROBOKASSA_PASSWORD_1', '');
    this.password2 = this.config.get<string>('ROBOKASSA_PASSWORD_2', '');
    this.isTest = this.config.get<string>('ROBOKASSA_IS_TEST', '1') === '1';
  }

  /**
   * Build MD5 signature for payment initiation.
   * Formula: MerchantLogin:OutSum:InvId:Password1
   */
  buildPaymentSignature(outSum: number, invId: number): string {
    const sumStr = typeof outSum === 'number' ? outSum.toFixed(2) : String(outSum);
    const str = `${this.merchantLogin}:${sumStr}:${invId}:${this.password1}`;
    return createHash('md5').update(str).digest('hex').toUpperCase();
  }

  /**
   * Build payment URL and params for redirect to Robokassa.
   */
  buildPaymentParams(outSum: number, invId: number, description: string): {
    paymentUrl: string;
    MerchantLogin: string;
    OutSum: string;
    InvId: number;
    Description: string;
    SignatureValue: string;
    IsTest: number;
  } {
    const sumStr = typeof outSum === 'number' ? outSum.toFixed(2) : String(outSum);
    const signature = this.buildPaymentSignature(outSum, invId);
    return {
      paymentUrl: ROBOKASSA_PAYMENT_URL,
      MerchantLogin: this.merchantLogin,
      OutSum: sumStr,
      InvId: invId,
      Description: description,
      SignatureValue: signature,
      IsTest: this.isTest ? 1 : 0,
    };
  }

  /**
   * Verify signature from Result URL callback.
   * Formula: OutSum:InvId:Password2[:Shp_param=value...] (Shp_ params sorted alphabetically)
   */
  verifyResultSignature(
    outSum: string,
    invId: string,
    signatureValue: string,
    shpParams?: Record<string, string>,
  ): boolean {
    const shpPart = shpParams && Object.keys(shpParams).length > 0
      ? ':' +
        Object.keys(shpParams)
          .sort()
          .map((k) => `Shp_${k}=${shpParams[k]}`)
          .join(':')
      : '';
    const str = `${outSum}:${invId}:${this.password2}${shpPart}`;
    const expected = createHash('md5').update(str).digest('hex').toUpperCase();
    return expected === signatureValue.toUpperCase();
  }

  /**
   * Verify signature from Success/Fail URL redirect.
   * Formula: OutSum:InvId:Password1[:Shp_param=value...] (Shp_ params sorted alphabetically)
   */
  verifySuccessFailSignature(
    outSum: string,
    invId: string,
    signatureValue: string,
    shpParams?: Record<string, string>,
  ): boolean {
    const shpPart = shpParams && Object.keys(shpParams).length > 0
      ? ':' +
        Object.keys(shpParams)
          .sort()
          .map((k) => `Shp_${k}=${shpParams[k]}`)
          .join(':')
      : '';
    const str = `${outSum}:${invId}:${this.password1}${shpPart}`;
    const expected = createHash('md5').update(str).digest('hex').toUpperCase();
    return expected === signatureValue.toUpperCase();
  }

  /**
   * Extract Shp_* params from request body (e.g. Shp_order -> order).
   */
  extractShpParams(body: Record<string, string>): Record<string, string> {
    const shp: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('Shp_') && value !== undefined) {
        shp[key.slice(4)] = value; // "Shp_order" -> "order"
      }
    }
    return shp;
  }
}
