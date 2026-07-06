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
