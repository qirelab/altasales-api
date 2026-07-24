import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { RopMeetingResponseDto } from './dto/rop-meeting-response.dto';
import { mapRopMeeting } from './rop-meeting.mapper';
import { RopService } from './rop.service';

@Injectable()
export class RopMeetingsService {
  constructor(
    private readonly ropService: RopService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async listForUser(userId: string): Promise<RopMeetingResponseDto[]> {
    const projectId = await this.getProjectId(userId);
    if (!projectId) {
      return [];
    }

    const meetings = await this.ropService.listMeetings(projectId);
    return meetings.map(mapRopMeeting);
  }

  async getForUser(userId: string, meetingId: string): Promise<RopMeetingResponseDto> {
    const projectId = await this.requireProjectId(userId);
    const meeting = await this.ropService.getMeeting(projectId, meetingId);
    return mapRopMeeting(meeting);
  }

  private async getProjectId(userId: string): Promise<string | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user.ropProjectId;
  }

  private async requireProjectId(userId: string): Promise<string> {
    const projectId = await this.getProjectId(userId);
    if (projectId) {
      return projectId;
    }

    if (!this.ropService.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

    throw new BadRequestException('Сначала заполните анкету');
  }
}
