alter table public.entries
drop constraint if exists entries_energy_level_check;

alter table public.entries
add constraint entries_energy_level_check
check (energy in ('high', 'low', 'zombie'));
