import { RopTaskResponseDto } from './dto/rop-task-response.dto';
import { RopTaskRecord } from './rop.types';

export function mapRopTask(task: RopTaskRecord): RopTaskResponseDto {
  return {
    id: String(task.id),
    projectId: String(task.project_id),
    title: task.task,
    comment: task.comment ?? null,
    documentLink: task.document_link ?? null,
    endDate: task.end_date ?? null,
    hoursSpent: task.hours_spent ?? null,
    priorityId: task.priority_id ?? null,
    startDate: task.start_date ?? null,
    stateId: task.state_id ?? null,
    stateUpdatedAt: task.state_updated_at ?? null,
    taskResult: task.task_result ?? null,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}
