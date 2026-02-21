-- Renaissance Commitments v2 (T1 + T2)
-- Run in Supabase SQL editor

-- 1) Extend commitments model for one-off vs ongoing accountability
alter table public.commitments
  add column if not exists kind text not null default 'one_off',
  add column if not exists cadence text not null default 'none',
  add column if not exists focus_area text,
  add column if not exists last_progress_at timestamptz,
  add column if not exists next_checkin_at timestamptz,
  add column if not exists progress_count_7d int not null default 0,
  add column if not exists progress_count_30d int not null default 0,
  add column if not exists confidence int,
  add column if not exists blocker_tag text,
  add column if not exists latest_progress_note text;

-- 2) Constrain enums via CHECKs (safe for existing rows)
alter table public.commitments
  drop constraint if exists commitments_kind_check,
  add constraint commitments_kind_check
    check (kind in ('one_off', 'ongoing'));

alter table public.commitments
  drop constraint if exists commitments_cadence_check,
  add constraint commitments_cadence_check
    check (cadence in ('none', 'daily', 'weekly', 'monthly'));

alter table public.commitments
  drop constraint if exists commitments_confidence_check,
  add constraint commitments_confidence_check
    check (confidence is null or (confidence >= 1 and confidence <= 5));

-- 3) Events table for historical progression
create table if not exists public.commitment_events (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.commitments(id) on delete cascade,
  event_type text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint commitment_events_event_type_check
    check (event_type in ('created', 'progressed', 'completed', 'reopened', 'abandoned', 'blocked'))
);

create index if not exists idx_commitment_events_commitment_created
  on public.commitment_events(commitment_id, created_at desc);

-- 4) Backfill cadence for existing open projects (heuristic)
update public.commitments c
set kind = 'ongoing', cadence = 'weekly'
from public.entries e
where c.thought_id = e.id
  and c.kind = 'one_off'
  and e.title ilike any (array[
    '%gym%',
    '%yoga%',
    '%business%',
    '%community%',
    '%engagement%'
  ]);
