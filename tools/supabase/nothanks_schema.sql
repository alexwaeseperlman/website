-- No Thanks!: online rooms (same Supabase project as Turns and Burns, its own tables).
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query). Safe to run again.
--
-- No sign-in needed. Each browser makes a random secret token and keeps it in localStorage; the token is
-- the player's seat in a room. Everyone can read a room's public state, but the deck and every player's
-- chips live in nothanks_seats / nothanks_decks, which nobody can read: the only way in is through the
-- functions below, which check the token and the rules on every move.

create table if not exists public.nothanks_rooms (
  code       text primary key,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nothanks_seats (
  code   text not null references public.nothanks_rooms (code) on delete cascade,
  pid    text not null,                 -- public id, shown in the room state
  token  uuid not null,                 -- secret, only this player's browser knows it
  chips  int  not null default 0,
  primary key (code, pid),
  unique (code, token)
);

create table if not exists public.nothanks_decks (
  code text primary key references public.nothanks_rooms (code) on delete cascade,
  deck int[] not null                   -- the face-down cards still to come
);

-- Row-level security: rooms are readable by everyone (that's how the game shows the table and gets live
-- updates); seats and decks have no policies at all, so they can't be read or written from the browser.
alter table public.nothanks_rooms enable row level security;
alter table public.nothanks_seats enable row level security;
alter table public.nothanks_decks enable row level security;
drop policy if exists "anyone can watch a no thanks room" on public.nothanks_rooms;
create policy "anyone can watch a no thanks room" on public.nothanks_rooms for select using (true);
revoke insert, update, delete on public.nothanks_rooms from anon, authenticated;
revoke all on public.nothanks_seats, public.nothanks_decks from anon, authenticated;

-- live updates: players subscribe to their room's row
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'nothanks_rooms')
  then alter publication supabase_realtime add table public.nothanks_rooms; end if;
end $$;

-- ---------------------------------------------------------------- helpers (not callable from the browser)

-- the room, locked for this move, or an error
create or replace function public.nothanks_lock(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  select state into s from nothanks_rooms where code = upper(p_code) for update;
  if s is null then raise exception 'No room with that code.'; end if;
  return s;
end $$;

create or replace function public.nothanks_pid(p_code text, p_token uuid) returns text
language sql stable security definer set search_path = public as $$
  select pid from nothanks_seats where code = upper(p_code) and token = p_token
$$;

create or replace function public.nothanks_save(p_code text, s jsonb) returns jsonb
language sql security definer set search_path = public as $$
  update nothanks_rooms set state = jsonb_set(s, '{v}', to_jsonb(coalesce((s->>'v')::int, 0) + 1)), updated_at = now()
  where code = upper(p_code) returning state
$$;

create or replace function public.nothanks_name(p_name text) returns text
language plpgsql immutable as $$
declare n text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 20);
begin
  if n = '' then raise exception 'Pick a name first.'; end if;
  return n;
end $$;

-- ---------------------------------------------------------------- the game's calls

-- make a room and sit in it as its host: {code, pid}
create or replace function public.nothanks_create(p_name text, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text; p text := substr(md5(gen_random_uuid()::text), 1, 8); n text := nothanks_name(p_name);
begin
  delete from nothanks_rooms where updated_at < now() - interval '3 days';   -- tidy up old rooms
  loop
    c := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from nothanks_rooms where code = c);
  end loop;
  insert into nothanks_rooms (code, state) values (c, jsonb_build_object(
    'phase', 'lobby', 'host', p, 'v', 1, 'card', null, 'pot', 0, 'turn', 0, 'left', 0, 'last', null,
    'players', jsonb_build_array(jsonb_build_object('pid', p, 'name', n, 'cards', '[]'::jsonb))));
  insert into nothanks_seats (code, pid, token) values (c, p, p_token);
  return jsonb_build_object('code', c, 'pid', p);
end $$;

-- take a seat in a room, or come back to the one this browser already has: {code, pid}
create or replace function public.nothanks_join(p_code text, p_name text, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb := nothanks_lock(p_code); c text := upper(p_code); p text := nothanks_pid(p_code, p_token); n text;
begin
  if p is not null then return jsonb_build_object('code', c, 'pid', p); end if;
  n := nothanks_name(p_name);
  if s->>'phase' = 'playing' then raise exception 'That game has already started.'; end if;
  if jsonb_array_length(s->'players') >= 7 then raise exception 'That room is full (7 players).'; end if;
  p := substr(md5(gen_random_uuid()::text), 1, 8);
  insert into nothanks_seats (code, pid, token) values (c, p, p_token);
  perform nothanks_save(c, jsonb_set(s, '{players}', (s->'players') || jsonb_build_object('pid', p, 'name', n, 'cards', '[]'::jsonb)));
  return jsonb_build_object('code', c, 'pid', p);
end $$;

-- leave a room that isn't mid-game; the next player becomes host, and an empty room is deleted
create or replace function public.nothanks_leave(p_code text, p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb := nothanks_lock(p_code); c text := upper(p_code); p text := nothanks_pid(p_code, p_token); ps jsonb;
begin
  if p is null then return; end if;
  if s->>'phase' = 'playing' then raise exception 'You can''t leave in the middle of a game.'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into ps from jsonb_array_elements(s->'players') x where x->>'pid' <> p;
  delete from nothanks_seats where code = c and pid = p;
  if jsonb_array_length(ps) = 0 then delete from nothanks_rooms where code = c; return; end if;
  s := jsonb_set(s, '{players}', ps);
  if s->>'host' = p then s := jsonb_set(s, '{host}', ps->0->'pid'); end if;
  perform nothanks_save(c, s);
end $$;

-- the host deals a new game (also used for a rematch): cards 3-35, nine of them removed unseen
create or replace function public.nothanks_start(p_code text, p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb := nothanks_lock(p_code); c text := upper(p_code); n int := jsonb_array_length(s->'players'); d int[]; ps jsonb;
begin
  if s->>'host' is distinct from nothanks_pid(p_code, p_token) then raise exception 'Only the host can start the game.'; end if;
  if s->>'phase' = 'playing' then raise exception 'The game has already started.'; end if;
  if n < 2 then raise exception 'You need at least 2 players.'; end if;
  select array_agg(v order by random()) into d from (select v from generate_series(3, 35) v order by random() limit 24) t;
  insert into nothanks_decks (code, deck) values (c, d[2:]) on conflict (code) do update set deck = excluded.deck;
  -- official chips: 11 each for 3-5 players, 9 for 6, 7 for 7 (2 players isn't official; it uses 11)
  update nothanks_seats set chips = case when n <= 5 then 11 when n = 6 then 9 else 7 end where code = c;
  select jsonb_agg(x - 'chips' || jsonb_build_object('cards', '[]'::jsonb)) into ps from jsonb_array_elements(s->'players') x;
  s := s || jsonb_build_object('phase', 'playing', 'players', ps, 'card', d[1], 'pot', 0, 'left', 23,
    'turn', floor(random() * n)::int, 'last', null, 'round', coalesce((s->>'round')::int, 0) + 1);
  return nothanks_save(c, s);
end $$;

-- the player whose turn it is says "No thanks!" (pays a chip, passes the card on) or takes the card and its chips.
-- Returns {chips} for the player who moved; the room row carries everything else.
create or replace function public.nothanks_act(p_code text, p_token uuid, p_take boolean, p_v int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb := nothanks_lock(p_code); c text := upper(p_code); p text := nothanks_pid(p_code, p_token);
  t int := (s->>'turn')::int; n int := jsonb_array_length(s->'players'); card int := (s->>'card')::int; pot int := (s->>'pot')::int;
  my int; d int[]; cards jsonb; ps jsonb;
begin
  if s->>'phase' <> 'playing' then raise exception 'The game isn''t running.'; end if;
  if p is null or s->'players'->t->>'pid' <> p then raise exception 'It''s not your turn.'; end if;
  if p_v is not null and p_v <> (s->>'v')::int then raise exception 'The table changed, try again.'; end if;
  select chips into my from nothanks_seats where code = c and pid = p for update;
  if not p_take then
    if my = 0 then raise exception 'You''re out of chips, so you have to take it.'; end if;
    update nothanks_seats set chips = chips - 1 where code = c and pid = p returning chips into my;
    s := s || jsonb_build_object('pot', pot + 1, 'turn', (t + 1) % n, 'last', jsonb_build_object('pid', p, 'take', false, 'card', card, 'pot', pot + 1));
    perform nothanks_save(c, s);
    return jsonb_build_object('chips', my);
  end if;
  update nothanks_seats set chips = chips + pot where code = c and pid = p returning chips into my;
  select jsonb_agg(v order by v::int) into cards from jsonb_array_elements((s->'players'->t->'cards') || to_jsonb(card)) v;
  s := jsonb_set(s, array['players', t::text, 'cards'], cards);
  s := s || jsonb_build_object('pot', 0, 'last', jsonb_build_object('pid', p, 'take', true, 'card', card, 'pot', pot));
  select deck into d from nothanks_decks where code = c for update;
  if coalesce(array_length(d, 1), 0) = 0 then
    -- last card taken: game over, everyone's chips are revealed for scoring
    select jsonb_agg(x || jsonb_build_object('chips', (select chips from nothanks_seats z where z.code = c and z.pid = x->>'pid')) order by i)
      into ps from jsonb_array_elements(s->'players') with ordinality e(x, i);
    s := s || jsonb_build_object('phase', 'done', 'players', ps, 'card', null, 'left', 0);
  else
    update nothanks_decks set deck = d[2:] where code = c;
    s := s || jsonb_build_object('card', d[1], 'left', array_length(d, 1) - 1);   -- same player decides again
  end if;
  perform nothanks_save(c, s);
  return jsonb_build_object('chips', my);
end $$;

-- this browser's seat and chips in a room (chips are secret, so they aren't in the room state): {pid, chips}
create or replace function public.nothanks_me(p_code text, p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pid', pid, 'chips', chips) from nothanks_seats where code = upper(p_code) and token = p_token
$$;

-- only the game's calls are open to the browser
revoke execute on function public.nothanks_lock(text), public.nothanks_pid(text, uuid), public.nothanks_save(text, jsonb),
  public.nothanks_name(text) from public, anon, authenticated;
revoke execute on function public.nothanks_create(text, uuid), public.nothanks_join(text, text, uuid), public.nothanks_leave(text, uuid),
  public.nothanks_start(text, uuid), public.nothanks_act(text, uuid, boolean, int), public.nothanks_me(text, uuid) from public;
grant execute on function public.nothanks_create(text, uuid), public.nothanks_join(text, text, uuid), public.nothanks_leave(text, uuid),
  public.nothanks_start(text, uuid), public.nothanks_act(text, uuid, boolean, int), public.nothanks_me(text, uuid) to anon, authenticated;
