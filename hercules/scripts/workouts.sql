create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  exercise text not null,
  set integer,
  reps integer,
  weight numeric,
  notes text
);

create index if not exists idx_workouts_created_at
  on public.workouts(created_at desc);

alter table public.workouts enable row level security;

drop policy if exists "workouts_insert_anon" on public.workouts;
create policy "workouts_insert_anon"
  on public.workouts
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists "workouts_select_anon" on public.workouts;
create policy "workouts_select_anon"
  on public.workouts
  for select
  to anon, authenticated
  using (true);

drop policy if exists "workouts_delete_anon" on public.workouts;
create policy "workouts_delete_anon"
  on public.workouts
  for delete
  to anon, authenticated
  using (true);
