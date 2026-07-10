export interface RopDocumentRecord {
  id: string | number;
  project_id: string | number;
  name: string;
  description?: string | null;
  comment?: string | null;
  link?: string | null;
  category_id?: number | null;
  status_id?: number | null;
  file_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface RopTaskRecord {
  id: string | number;
  project_id: string | number;
  task: string;
  comment?: string | null;
  document_link?: string | null;
  end_date?: string | null;
  hours_spent?: number | null;
  priority_id?: number | null;
  start_date?: string | null;
  state_id?: number | null;
  state_updated_at?: string | null;
  task_result?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RopTaskListFilters {
  startDate?: string;
  endDate?: string;
}
