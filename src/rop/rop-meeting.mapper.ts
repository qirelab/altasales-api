import { RopMeetingResponseDto } from './dto/rop-meeting-response.dto';
import { RopMeetingRecord } from './rop.types';

export function mapRopMeeting(meeting: RopMeetingRecord): RopMeetingResponseDto {
  return {
    id: String(meeting.id),
    projectId: String(meeting.project_id),
    title: meeting.title ?? meeting.topic ?? null,
    description: meeting.description ?? null,
    comment: meeting.comment ?? null,
    meetingDate: meeting.meeting_date ?? null,
    startsAt: meeting.starts_at ?? meeting.meeting_at ?? null,
    endsAt: meeting.ends_at ?? null,
    link: meeting.link ?? meeting.meeting_link ?? null,
    statusId: meeting.status_id ?? null,
    createdAt: meeting.created_at,
    updatedAt: meeting.updated_at,
  };
}
