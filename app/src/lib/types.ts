export type Bucket =
  | 'active_contact'
  | 'awaiting_meeting'
  | 'holding'
  | 'deferred'
  | 'converting'      // shown as Prospect: agreed to join, onboarding
  | 'client'          // funded
  | 'out';

export type Product = 'RIA' | 'PMS' | 'US RIA';
export const PRODUCTS: Product[] = ['RIA', 'PMS', 'US RIA'];
/** "us ria", "US-RIA", "usria" → 'US RIA' (mirrors public.normalize_product). */
export function normalizeProduct(p: unknown): Product | null {
  const k = String(p ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return k === 'RIA' ? 'RIA' : k === 'PMS' ? 'PMS' : k === 'USRIA' ? 'US RIA' : null;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: 'rm' | 'admin';
  unit: string;
  is_active: boolean;
  in_rotation: boolean;
  last_assigned_at: string | null;
  team: Team;
  calendly_url: string | null;
  calendly_connected_at: string | null;
  cal_url: string | null;
  cal_connected_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  gmail_address: string | null;
  gmail_connected_at: string | null;
  created_at: string;
  manager_id?: string | null;
  route_languages?: string[];
  route_products?: string[];
  takes_nri?: boolean;
  max_open_leads?: number | null;
  on_leave?: boolean;
}

export interface Lead {
  id: string;
  unit: string;
  name: string;
  phone: string | null;
  alt_phone?: string | null;
  email: string | null;
  city: string | null;
  age: number | null;
  marital_status: string | null;
  income_band: string | null;
  language: string | null;          // comma-separated: "Hindi, English"
  languages?: string[] | null;
  general_notes?: string | null;
  notes_updated_at?: string | null;
  notes_updated_by?: string | null;
  residency?: 'resident' | 'nri' | null;
  meeting_pref?: 'google-meet' | 'zoom' | null;
  funded_at?: string | null;
  funded_amount?: number | null;
  requirement: string | null;
  budget: string | null;
  product: Product;
  source: string;
  campaign: string | null;
  referred_by: string | null;
  bucket: Bucket;
  strikes: number;
  holding_step?: number;
  next_follow_up_at?: string | null;
  next_follow_up: string | null;
  meeting_at: string | null;
  meeting_url: string | null;
  deferred_until: string | null;
  out_reason: string | null;
  out_from_bucket: Bucket | null;
  out_at: string | null;
  converted_at: string | null;
  last_contact_at: string | null;
  rm_id: string;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
}

export type EntryKind = 'meet_call' | 'phone_call' | 'in_person' | 'message' | 'email' | 'note';
export type Outcome = 'connected' | 'no_answer' | 'call_back' | 'not_interested' | 'sent' | 'replied';

export interface LeadEntry {
  id: string;
  lead_id: string;
  kind: EntryKind;
  occurred_at: string;
  outcome: Outcome | null;
  notes: string | null;
  bucket_at: Bucket;
  strike_state: 'none' | 'counted' | 'pending';
  created_by: string | null;
  created_at: string;
}

export interface LeadEvent {
  id: number;
  lead_id: string;
  kind: string;
  from_value: string | null;
  to_value: string | null;
  detail: Record<string, unknown> | null;
  actor: string | null;
  at: string;
}

export interface LeadSource {
  name: string;
  kind: 'cold' | 'warm';
  is_active: boolean;
  sort_order: number;
}

export interface ImportBatch {
  id: string;
  file_name: string;
  source: string;
  campaign: string | null;
  product: Product | null;
  dup_mode: 'skip' | 'merge';
  uploaded_by: string;
  created_at: string;
  total_rows: number;
  inserted: number;
  merged: number;
  skipped: number;
  failed: number;
  undone_at: string | null;
  undone_count: number | null;
}

export const BUCKETS: { key: Bucket; label: string; short: string; help: string }[] = [
  { key: 'active_contact', label: 'Follow-up', short: 'Follow-up', help: 'You have reached out; follow up on the date and time set. Five unanswered attempts send it to the Out List.' },
  { key: 'awaiting_meeting', label: 'Awaiting meeting', short: 'Meeting', help: 'Agreed to meet. Five reminders with no meeting sends it to the Out List.' },
  { key: 'holding', label: 'Holding period', short: 'Holding', help: 'Met, still thinking. No strikes: follow-ups are spaced out automatically (7, 14, 28, 56 days…, at most 90). Record a decision with Log activity.' },
  { key: 'deferred', label: 'Deferred', short: 'Deferred', help: 'Will commit later. Returns to Holding on the agreed date. If they get in touch early, use Log activity.' },
  { key: 'converting', label: 'Prospect', short: 'Prospect', help: 'Agreed to join; onboarding in progress (documents, accounts). Becomes a client when they fund.' },
  { key: 'client', label: 'Client', short: 'Client', help: 'Funded. Onboarding complete.' },
  { key: 'out', label: 'Out List', short: 'Out', help: 'Five strikes or not interested. Can be brought back.' },
];

export const bucketLabel = (b: Bucket) => BUCKETS.find((x) => x.key === b)?.label ?? b;

export const ENTRY_KINDS: { key: EntryKind; label: string }[] = [
  { key: 'phone_call', label: 'Phone call' },
  { key: 'meet_call', label: 'Google Meet call' },
  { key: 'in_person', label: 'In-person' },
  { key: 'message', label: 'Message' },
  { key: 'email', label: 'Email' },
  { key: 'note', label: 'Note' },
];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  connected: 'Connected',
  no_answer: 'No answer',
  call_back: 'Call back',
  not_interested: 'Not interested',
  sent: 'Sent',
  replied: 'Replied',
};

export const CALL_OUTCOMES: Outcome[] = ['connected', 'no_answer', 'call_back', 'not_interested'];
export const MESSAGE_OUTCOMES: Outcome[] = ['sent', 'replied', 'not_interested'];

export const INCOME_BANDS = ['< ₹10L', '₹10–25L', '₹25–50L', '₹50L–1Cr', '> ₹1Cr'];
export const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];
export const LANGUAGES = ['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Bengali', 'Malayalam', 'Punjabi', 'Urdu'];

/* ───────── tasks ───────── */
export type Team = 'Sales' | 'Operations' | 'Compliance' | 'Investment';
export const TEAMS: Team[] = ['Sales', 'Operations', 'Compliance', 'Investment'];

export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done';
export type TaskPriority = 'high' | 'medium' | 'low';

export const TASK_STATUSES: { key: TaskStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];
export const statusLabel = (s: TaskStatus) => TASK_STATUSES.find((x) => x.key === s)?.label ?? s;
export const PRIORITIES: { key: TaskPriority; label: string }[] = [
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];

export interface Task {
  id: string;
  title: string;
  details: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  blocked_reason: string | null;
  template: string | null;
  from_team: Team;
  to_team: Team;
  assignee_id: string | null;
  lead_id: string | null;
  lead_name: string | null;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

export interface TaskComment { id: string; task_id: string; author: string; body: string; created_at: string }
export interface TaskEvent { id: number; task_id: string; kind: string; from_value: string | null; to_value: string | null; detail: Record<string, unknown> | null; actor: string | null; at: string }

/** Templates fill the title, owning team and a details outline. */
export const TASK_TEMPLATES: { key: string; label: string; title: string; to_team: Team; details: string }[] = [
  { key: 'account_opening', label: 'Account opening', title: 'Open account', to_team: 'Operations', details: 'Product:\nDemat / broker:\nDocuments shared:\n' },
  { key: 'address_change', label: 'Address change', title: 'Address change', to_team: 'Operations', details: 'Old address:\nNew address:\nProof attached / sent by:\n' },
  { key: 'strategy_switch', label: 'Strategy switch', title: 'Strategy switch', to_team: 'Investment', details: 'Current strategy:\nRequested strategy:\nReason:\n' },
  { key: 'withdrawal', label: 'Withdrawal', title: 'Withdrawal request', to_team: 'Operations', details: 'Amount (₹):\nDate needed by:\nBank account:\n' },
  { key: 'top_up', label: 'Top-up', title: 'Top-up', to_team: 'Operations', details: 'Amount (₹):\nDate:\nMode of payment:\n' },
  { key: 'compliance_query', label: 'Compliance query', title: 'Compliance query', to_team: 'Compliance', details: 'Question:\n' },
];

export interface AppNotification {
  id: string; user_id: string; kind: string; title: string; body: string | null; link: string | null;
  read_at: string | null; created_at: string;
}
export const NOTIFICATION_KINDS: { key: string; label: string }[] = [
  { key: 'lead_assigned', label: 'New leads' },
  { key: 'digest', label: 'Daily digest' },
  { key: 'meeting_soon', label: 'Meeting reminders' },
  { key: 'meeting_booked', label: 'Bookings' },
  { key: 'meeting_canceled', label: 'Cancellations' },
  { key: 'task', label: 'Tasks' },
  { key: 'email_reply', label: 'Email replies' },
  { key: 'nudge', label: 'Nudges' },
  { key: 'duplicate', label: 'Duplicate leads' },
  { key: 'access_request', label: 'Access requests' },
  { key: 'access_approved', label: 'Access' },
];

/** Days until the next follow-up for a Holding lead after `step` follow-ups (7, 14, 28 … max 90). */
export const holdingGap = (step: number) => Math.min(7 * 2 ** Math.max(step, 0), 90);

export type ItemStatus = 'todo' | 'waiting' | 'submitted' | 'done' | 'blocked';
export const ITEM_STATUSES: { key: ItemStatus; label: string }[] = [
  { key: 'todo', label: 'To do' },
  { key: 'waiting', label: 'Waiting on client' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'done', label: 'Done' },
  { key: 'blocked', label: 'Blocked' },
];
export interface Holder { id: string; lead_id: string; name: string; relation: string | null }
export interface OnboardingItem {
  id: string; lead_id: string; holder_id: string | null; title: string; owner: 'rm' | 'ops'; status: ItemStatus;
  blocked_reason: string | null; due_date: string | null; notes: string | null; task_id: string | null;
  sort_order: number; done_at: string | null; created_at: string;
}
export interface OnboardingTemplate {
  id: string; product: string; residency: 'resident' | 'nri'; title: string; owner: 'rm' | 'ops';
  per_holder: boolean; sort_order: number; is_active: boolean;
}
export const RESIDENCY_LABEL: Record<string, string> = { resident: 'Resident', nri: 'NRI' };

/** A lead nobody has reached out to yet: shown as "New", not as a follow-up. */
export const isNewLead = (l: Pick<Lead, 'bucket' | 'next_follow_up'>) => l.bucket === 'active_contact' && !l.next_follow_up;
