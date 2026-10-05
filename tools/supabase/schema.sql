-- Turns: one row of saved progress per player.
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).

create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row-level security: a signed-in player can read and write only their own row.
-- There is deliberately no delete policy, so the game can never delete a row.
alter table public.progress enable row level security;

create policy "players read their own progress"
  on public.progress for select
  using (auth.uid() = user_id);

create policy "players create their own progress"
  on public.progress for insert
  with check (auth.uid() = user_id);

create policy "players update their own progress"
  on public.progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
