-- Community levels for Turns (the level builder publishes here; see public/turns/builder.js).
-- Applied to the Supabase project "turns" as the migration `turns_levels`.
create table public.turns_levels (
  id          bigint generated always as identity primary key,
  author_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text not null default '' check (char_length(author_name) <= 40),
  name        text not null check (char_length(name) between 1 and 40),
  data        jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 60000),
  plays       integer not null default 0,
  solves      integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index turns_levels_plays_idx on public.turns_levels (plays desc, id desc);
create index turns_levels_author_idx on public.turns_levels (author_id);

alter table public.turns_levels enable row level security;
-- anyone can read; only the signed-in author can add, change or remove their own levels
create policy "levels are public" on public.turns_levels for select to anon, authenticated using (true);
create policy "authors add levels" on public.turns_levels for insert to authenticated with check (author_id = (select auth.uid()));
create policy "authors change their levels" on public.turns_levels for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "authors remove their levels" on public.turns_levels for delete to authenticated using (author_id = (select auth.uid()));

-- authors can't set the counters or the owner: only these columns are writable
revoke all on public.turns_levels from anon, authenticated;
grant select on public.turns_levels to anon, authenticated;
grant insert (name, author_name, data) on public.turns_levels to authenticated;
grant update (name, author_name, data, updated_at) on public.turns_levels to authenticated;
grant delete on public.turns_levels to authenticated;

-- play and solve counters, bumped by the game for anyone who plays
create function public.turns_level_bump(level_id bigint, solved boolean default false)
returns void language sql security definer set search_path = '' as $$
  update public.turns_levels
     set plays = plays + (case when solved then 0 else 1 end),
         solves = solves + (case when solved then 1 else 0 end)
   where id = level_id;
$$;
revoke all on function public.turns_level_bump(bigint, boolean) from public;
grant execute on function public.turns_level_bump(bigint, boolean) to anon, authenticated;
