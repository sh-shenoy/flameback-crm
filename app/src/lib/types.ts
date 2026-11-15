export type Bucket =
  | 'active_contact'
  | 'awaiting_meeting'
  | 'holding'
  | 'deferred'
  | 'converting'
  | 'out';

export type Product = 'RIA' | 'PMS';
export const PRODUCTS: Product[] = ['RIA', 'PMS'];

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
}

export interface Lead {
  id: string;
  unit: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  age: number | null;
  marital_status: string | null;
  income_band: string | null;
  language: string | null;
  requirement: string | null;
  budget: string | null;
  product: Product;
  source: string;
  campaign: string | null;
  referred_by: string | null;
  bucket: Bucket;
  strikes: number;
  next_follow_up: string | null;
  meeting_at: string | null;
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
  { key: 'active_contact', label: 'Active contact', short: 'Contact', help: 'Being worked. Five unanswered attempts sends it to the Out List.' },
  { key: 'awaiting_meeting', label: 'Awaiting meeting', short: 'Meeting', help: 'Agreed to meet. Five reminders with no meeting sends it to the Out List.' },
  { key: 'holding', label: 'Holding period', short: 'Holding', help: 'Met but not yet committed. Five follow-ups with no commitment sends it to the Out List.' },
  { key: 'deferred', label: 'Deferred', short: 'Deferred', help: 'Will commit later. Returns to Holding on the agreed date.' },
  { key: 'converting', label: 'Converting', short: 'Converting', help: 'Committed. Hands off to onboarding.' },
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
export const LANGUAGES = ['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil', 'Telugu', 'Kannada', 'Bengali', 'Malayalam', 'Other'];
