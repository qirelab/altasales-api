import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AppSetting } from './entities/app-setting.entity';

const VAT_RATE_KEY = 'vatRatePercent';
const DEFAULT_VAT_RATE_PERCENT = 20;

export interface PublicSettingsResponse {
  vatRatePercent: number;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly appSettingRepository: Repository<AppSetting>,
  ) {}

  async getPublicSettings(): Promise<PublicSettingsResponse> {
    const vatRatePercent = await this.getVatRatePercent();
    return { vatRatePercent };
  }

  async updateSettings(dto: UpdateSettingsDto): Promise<PublicSettingsResponse> {
    await this.appSettingRepository.save({
      key: VAT_RATE_KEY,
      value: String(dto.vatRatePercent),
    });

    return { vatRatePercent: dto.vatRatePercent };
  }

  private async getVatRatePercent(): Promise<number> {
    const setting = await this.appSettingRepository.findOne({ where: { key: VAT_RATE_KEY } });
    const parsed = Number(setting?.value);

    if (!Number.isFinite(parsed)) {
      return DEFAULT_VAT_RATE_PERCENT;
    }

    return parsed;
  }
}
