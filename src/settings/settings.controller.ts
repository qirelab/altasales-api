import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { PublicSettingsResponse, SettingsService } from './settings.service';

@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings')
  @UseGuards(SessionGuard)
  @ApiOperation({ summary: 'Get application settings used by frontend' })
  @ApiResponse({ status: 200, description: 'Current settings' })
  getSettings(): Promise<PublicSettingsResponse> {
    return this.settingsService.getPublicSettings();
  }

  @Patch('admin/settings')
  @UseGuards(SessionGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update application settings (admin)' })
  @ApiResponse({ status: 200, description: 'Settings updated' })
  updateSettings(
    @Body() dto: UpdateSettingsDto,
  ): Promise<PublicSettingsResponse> {
    return this.settingsService.updateSettings(dto);
  }
}
