export interface Client {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  company: string | null;
  notes: string | null;
  ignored: boolean;
  created_at: string;
}
export interface Project {
  id: string;
  project_name: string;
  created_by?: string | null;
  project_number: string;
  client_id: string | null;
  status: "inquiry" | "booked" | "completed" | "cancelled";
  event_date: string | null;
  notes: string | null;
  created_at: string;
}
export interface Email {
  id: string;
  account_id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  client_id: string | null;
  project_id: string | null;
  direction: "inbound" | "outbound";
  from_address: string | null;
  from_name: string | null;
  to_addresses: string | null;
  subject: string | null;
  body: string | null;
  snippet: string | null;
  sent_at: string;
  is_read: boolean;
}
export interface Draft {
  id: string;
  account_id: string;
  email_id: string;
  version: number;
  body: string;
  status: "pending" | "sending" | "sent" | "declined" | "superseded";
  created_by: string;
  review_note: string | null;
  suggested_project_id: string | null;
  suggestion_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export type ProjectLite = Pick<Project, "id" | "project_name" | "project_number" | "client_id" | "status">;
