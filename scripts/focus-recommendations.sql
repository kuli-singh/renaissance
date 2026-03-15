-- Renaissance Focus Recommendations
-- Run in Supabase SQL editor

create table if not exists public.focus_recommendations (
  id uuid primary key default gen_random_uuid(),
  focus_date date not null,
  recommended_focus_thought_id uuid references public.entries(id) on delete set null,
  recommended_focus_reason text,
  starter_step text,
  narrative text,
  phase text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint focus_recommendations_phase_check
    check (phase is null or phase in ('morning', 'midday', 'evening'))
);

create index if not exists idx_focus_recommendations_focus_date
  on public.focus_recommendations(focus_date desc, created_at desc);

create index if not exists idx_focus_recommendations_thought_id
  on public.focus_recommendations(recommended_focus_thought_id);

create unique index if not exists idx_focus_recommendations_focus_date_phase
  on public.focus_recommendations(focus_date, coalesce(phase, 'none'));

create or replace function public.set_focus_recommendations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_focus_recommendations_updated_at on public.focus_recommendations;

create trigger trg_focus_recommendations_updated_at
before update on public.focus_recommendations
for each row
execute function public.set_focus_recommendations_updated_at();
