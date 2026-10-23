-- No Thanks!: online rooms (same Supabase project as Turns and Burns, its own tables).
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query). Safe to run again.
--
-- Bots can sit in a room too. The server decides their moves (nothanks_bot), so they play by the same hidden
-- information as everyone else; any player's browser just asks for the bot's move when it's a bot's turn.
--
-- No sign-in needed. Each browser makes a random secret token and keeps it in localStorage; the token is
-- the player's seat in a room. Everyone can read a room's public state, including every player's chip count
-- (copied from nothanks_seats on each move). The deck and the seat tokens live in nothanks_decks / nothanks_seats,
-- which nobody can read: the only way in is through the functions below, which check the token and the rules.

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
  if not exists (select 1 from jsonb_array_elements(ps) x where not coalesce((x->>'bot')::boolean, false)) then
    delete from nothanks_rooms where code = c; return; end if;   -- nobody left but bots
  s := jsonb_set(s, '{players}', ps);
  if s->>'host' = p then
    s := jsonb_set(s, '{host}', (select x->'pid' from jsonb_array_elements(ps) x where not coalesce((x->>'bot')::boolean, false) limit 1)); end if;
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
  select jsonb_agg(x || jsonb_build_object('cards', '[]'::jsonb, 'chips', case when n <= 5 then 11 when n = 6 then 9 else 7 end)) into ps from jsonb_array_elements(s->'players') x;
  s := s || jsonb_build_object('phase', 'playing', 'players', ps, 'card', d[1], 'pot', 0, 'left', 23,
    'turn', floor(random() * n)::int, 'last', null, 'round', coalesce((s->>'round')::int, 0) + 1);
  return nothanks_save(c, s);
end $$;

-- one move by the player whose turn it is (t): "No thanks!" pays a chip and passes the card on, or take the card and
-- its chips. Returns that player's chips.
create or replace function public.nothanks_do(c text, s jsonb, p_take boolean) returns int
language plpgsql security definer set search_path = public as $$
declare t int := (s->>'turn')::int; n int := jsonb_array_length(s->'players'); p text := s->'players'->t->>'pid';
  card int := (s->>'card')::int; pot int := (s->>'pot')::int; my int; d int[]; cards jsonb; ps jsonb;
begin
  select chips into my from nothanks_seats where code = c and pid = p for update;
  if not p_take then
    if my = 0 then raise exception 'You''re out of chips, so you have to take it.'; end if;
    update nothanks_seats set chips = chips - 1 where code = c and pid = p returning chips into my;
    s := jsonb_set(s, array['players', t::text, 'chips'], to_jsonb(my));
    s := s || jsonb_build_object('pot', pot + 1, 'turn', (t + 1) % n, 'last', jsonb_build_object('pid', p, 'take', false, 'card', card, 'pot', pot + 1));
    perform nothanks_save(c, s);
    return my;
  end if;
  update nothanks_seats set chips = chips + pot where code = c and pid = p returning chips into my;
  select jsonb_agg(v order by v::int) into cards from jsonb_array_elements((s->'players'->t->'cards') || to_jsonb(card)) v;
  s := jsonb_set(s, array['players', t::text, 'cards'], cards);
  s := jsonb_set(s, array['players', t::text, 'chips'], to_jsonb(my));
  s := s || jsonb_build_object('pot', 0, 'last', jsonb_build_object('pid', p, 'take', true, 'card', card, 'pot', pot));
  select deck into d from nothanks_decks where code = c for update;
  if coalesce(array_length(d, 1), 0) = 0 then
    -- last card taken: game over (chips re-read from the seats so the final scores come from the source of truth)
    select jsonb_agg(x || jsonb_build_object('chips', (select chips from nothanks_seats z where z.code = c and z.pid = x->>'pid')) order by i)
      into ps from jsonb_array_elements(s->'players') with ordinality e(x, i);
    s := s || jsonb_build_object('phase', 'done', 'players', ps, 'card', null, 'left', 0);
  else
    update nothanks_decks set deck = d[2:] where code = c;
    s := s || jsonb_build_object('card', d[1], 'left', array_length(d, 1) - 1);   -- same player decides again
  end if;
  perform nothanks_save(c, s);
  return my;
end $$;

-- a hand's points: each card counts unless the card one below it is also in the hand
create or replace function public.nothanks_points(cards int[]) returns int
language sql immutable as $$
  select coalesce(sum(v), 0)::int from unnest(cards) v where not (v - 1 = any(cards))
$$;

-- the player whose turn it is moves. p_v (optional) is the room version the player saw, so a stale tap is refused.
-- Returns {chips} for the player who moved; the room row carries everything else.
create or replace function public.nothanks_act(p_code text, p_token uuid, p_take boolean, p_v int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb := nothanks_lock(p_code); p text := nothanks_pid(p_code, p_token);
begin
  if s->>'phase' <> 'playing' then raise exception 'The game isn''t running.'; end if;
  if p is null or s->'players'->((s->>'turn')::int)->>'pid' <> p then raise exception 'It''s not your turn.'; end if;
  if p_v is not null and p_v <> (s->>'v')::int then raise exception 'The table changed, try again.'; end if;
  return jsonb_build_object('chips', nothanks_do(upper(p_code), s, p_take));
end $$;

-- The bots' policy, learned offline by counterfactual regret minimization (tools/no_thanks_cfr): one character per
-- kind of situation (nothanks_bot_key), '.' if training never saw it, otherwise how often to take the card, as a
-- base64url digit out of 63. tools/supabase/nothanks_policy.sql fills it in.
create table if not exists public.nothanks_policy (
  id     int primary key,
  policy text not null
);
alter table public.nothanks_policy enable row level security;
revoke all on public.nothanks_policy from anon, authenticated;

-- which bucket a decision falls in: the same buckets as tools/no_thanks_cfr/game.js and the page's botKey
create or replace function public.nothanks_bot_key(hand int[], chips int, card int, pot int, fits_opp boolean, min_opp int, deck_left int, n int)
returns int language sql immutable set search_path = public as $$
  select ((((((
      case when cost <= -4 then 0 when cost <= -1 then 1 when cost <= 2 then 2 when cost <= 5 then 3 when cost <= 9 then 4
           when cost <= 14 then 5 when cost <= 20 then 6 else 7 end * 6
    + case when chips <= 1 then 0 when chips = 2 then 1 when chips <= 4 then 2 when chips <= 7 then 3 when chips <= 11 then 4 else 5 end) * 3
    + case when pot <= 1 then 0 when pot <= 4 then 1 else 2 end) * 2
    + case when card - 1 = any(hand) or card + 1 = any(hand) then 1 else 0 end) * 2
    + case when fits_opp then 1 else 0 end) * 3
    + case when min_opp = 0 then 0 when min_opp <= 3 then 1 else 2 end) * 3
    + case when deck_left >= 16 then 0 when deck_left >= 8 then 1 else 2 end) * 3
    + case when n <= 3 then 0 when n <= 5 then 1 else 2 end
  from (select nothanks_points(hand || card) - nothanks_points(hand) - pot as cost) x
$$;

-- The neural-net bot (cnet3 in tools/no_thanks_cfr/deep.cpp), used at every table size. w holds one or more such nets
-- one after another, 16858 weights each, and the bot averages their outputs: regrets for nets trained with Deep CFR,
-- or (logit) the take logit and a value for nets trained with PPO.
-- Their weights ship as 16-bit integers with one scale per layer part (tools/supabase/nothanks_net.sql loads them) and
-- are unpacked once into w. Same layout as the page's NET_LAYERS: conv1 4x5->12 (offset 0), conv2 12x3->12 (252),
-- encoder 106->32 (696), trunk 131->64 (4120), 64->64 (12568), 64->2 (16728); each is weights then biases.
create table if not exists public.nothanks_net (
  id     int primary key,
  scales real[] not null,
  q      bytea not null,
  w      real[],
  logit  boolean not null default false
);
alter table public.nothanks_net add column if not exists logit boolean not null default false;
alter table public.nothanks_net enable row level security;
revoke all on public.nothanks_net from anon, authenticated;

-- one layer: y = W x + b (ReLU optional). w is 1-based; off / ioff are 0-based offsets like the page's
create or replace function public.nothanks_net_dense(w real[], off int, nin int, nout int, inp real[], ioff int, relu boolean)
returns real[] language plpgsql immutable as $$
declare y real[] := array_fill(0::real, array[nout]); s float8; rw int;
begin
  for j in 0 .. nout - 1 loop
    s := w[off + nin * nout + j + 1]; rw := off + j * nin;
    for k in 0 .. nin - 1 loop s := s + w[rw + k + 1]::float8 * inp[ioff + k + 1]::float8; end loop;
    y[j + 1] := case when relu and s < 0 then 0 else s end;
  end loop;
  return y;
end $$;

-- a 1D convolution over the 33 card positions, zero padded, then ReLU: y[co][pos] = b[co] + sum over ci, j of
-- w[co][ci][j] * x[ci][pos + j - k/2]. x and y are flattened channel by channel (x[ci * 33 + pos + 1]).
-- Only nonzero inputs are visited (the card channels are mostly zeros); base, if given, is added before the ReLU.
create or replace function public.nothanks_net_conv(w real[], off int, nci int, nco int, k int, x real[], base real[], relu boolean)
returns real[] language plpgsql immutable as $$
declare y float8[] := array_fill(0::float8, array[nco * 33]); v float8; q int; o int; r real[] := array_fill(0::real, array[nco * 33]);
begin
  for ci in 0 .. nci - 1 loop
    for p in 0 .. 32 loop
      v := x[ci * 33 + p + 1];
      if v <> 0 then
        for j in 0 .. k - 1 loop
          q := p - j + k / 2;   -- the output position that reads input p through tap j
          if q >= 0 and q < 33 then
            for co in 0 .. nco - 1 loop
              o := co * 33 + q + 1; y[o] := y[o] + w[off + (co * nci + ci) * k + j + 1]::float8 * v;
            end loop;
          end if;
        end loop;
      end if;
    end loop;
  end loop;
  for co in 0 .. nco - 1 loop
    for p in 0 .. 32 loop
      o := co * 33 + p + 1; v := y[o] + w[off + nco * nci * k + co + 1] + coalesce(base[o], 0);
      r[o] := case when relu and v < 0 then 0 else v end;
    end loop;
  end loop;
  return r;
end $$;

-- how often the net takes the card: the same features and forward pass as the page's netFeatures / netForward.
-- opp_cards / opp_chips: the other players in turn order after the mover. Null if the net isn't loaded.
create or replace function public.nothanks_net_take(hand int[], chips int, card int, pot int, lft int, n int, opp_cards jsonb, opp_chips int[])
returns real language plpgsql stable set search_path = public as $$
declare w real[]; seen int[] := hand; pc int[]; pch int; c int := card - 3; pos int; b int; r1 float8 := 0; r2 float8 := 0; nn int;
  vx real[] := array_fill(0::real, array[132]); vbase real[]; inp real[]; a real[]; fl real[]; tin real[] := array_fill(0::real, array[131]);
  es real[] := '{}'; res real[]; s float8; m float8; sa float8; sb float8; lg boolean;
begin
  select net.w, net.logit into w, lg from nothanks_net net where id = 1;
  if w is null or array_length(w, 1) % 16858 <> 0 then return null; end if;
  nn := array_length(w, 1) / 16858;
  for k in 0 .. n - 2 loop seen := seen || array(select jsonb_array_elements_text(opp_cards->k)::int); end loop;
  for i in 0 .. 32 loop vx[99 + i + 1] := (i + 3) / 35.0; end loop;
  for net_i in 0 .. nn - 1 loop   -- each net in turn
    b := net_i * 16858; es := '{}';
    -- conv1 of the value channel (card / 35) is the same for every player: work it out once, without bias or ReLU
    vbase := nothanks_net_conv(w, b, 4, 12, 5, vx, null, false);
    for i in 1 .. 396 loop vbase[i] := vbase[i] - w[b + 240 + (i - 1) / 33 + 1]; end loop;   -- take the bias back out
    -- every player (the mover first, then in turn order) through the shared encoder; positions are 0-based like the page
    for k in 0 .. n - 1 loop
      if k = 0 then pc := hand; pch := chips; else pc := array(select jsonb_array_elements_text(opp_cards->(k - 1))::int); pch := opp_chips[k]; end if;
      inp := array_fill(0::real, array[132]);
      for p in 0 .. 32 loop
        if p + 3 = any(pc) then inp[p + 1] := 1; end if;
        if p + 3 = any(seen) then inp[33 + p + 1] := 1; end if;
      end loop;
      inp[66 + c + 1] := 1;
      a := nothanks_net_conv(w, b + 252, 12, 12, 3, nothanks_net_conv(w, b, 4, 12, 5, inp, vbase, true), null, true);
      fl := array_fill(0::real, array[106]);
      for d in -2 .. 2 loop
        pos := c + d;
        if pos >= 0 and pos < 33 then for co in 0 .. 11 loop fl[(d + 2) * 12 + co + 1] := a[co * 33 + pos + 1]; end loop; end if;
      end loop;
      for co in 0 .. 11 loop
        s := 0; m := -1;
        for p in 0 .. 32 loop s := s + a[co * 33 + p + 1]; m := greatest(m, a[co * 33 + p + 1]); end loop;
        fl[60 + co + 1] := s / 33; fl[72 + co + 1] := m;
      end loop;
      for d in -3 .. 3 loop
        pos := c + d;
        if pos >= 0 and pos < 33 then fl[84 + (d + 3) * 2 + 1] := inp[pos + 1]; fl[84 + (d + 3) * 2 + 2] := inp[33 + pos + 1]; end if;
      end loop;
      fl[99] := pch / 11.0; fl[100 + k] := 1;
      es := es || nothanks_net_dense(w, b + 696, 106, 32, fl, 0, true);
    end loop;
    -- trunk input: mover, sum and max of the opponents, next player, table
    for h in 1 .. 32 loop
      s := 0; m := -1;
      for k in 1 .. n - 1 loop s := s + es[k * 32 + h]; m := greatest(m, es[k * 32 + h]); end loop;
      tin[h] := es[h]; tin[32 + h] := s; tin[64 + h] := m; tin[96 + h] := es[32 + h];
    end loop;
    tin[129] := pot / 11.0; tin[130] := lft / 23.0; tin[131] := (n - 2) / 5.0;
    res := nothanks_net_dense(w, b + 16728, 64, 2, nothanks_net_dense(w, b + 12568, 64, 64, nothanks_net_dense(w, b + 4120, 131, 64, tin, 0, true), 0, true), 0, false);
    r1 := r1 + res[1] / nn; r2 := r2 + res[2] / nn;
  end loop;
  if lg then return 1 / (1 + exp(-r1)); end if;
  sa := greatest(r1, 0); sb := greatest(r2, 0);   -- regret matching
  return case when sa + sb > 0 then sa / (sa + sb) when r1 > r2 then 1 else 0 end;
end $$;

-- a bot's move. Any player's browser calls this when it sees a bot's turn at room version p_v; the first call
-- moves the bot and the rest find the version changed and do nothing. The bot uses the neural net; if the net isn't
-- loaded it follows the CFR policy table; in a
-- situation the training never reached it falls back to a rule of thumb: take a card when it costs little after
-- the chips on it, more readily as its chips run out, and sometimes let a card it wants go round again.
create or replace function public.nothanks_bot(p_code text, p_v int) returns boolean
language plpgsql security definer set search_path = public as $$
declare s jsonb := nothanks_lock(p_code); c text := upper(p_code); me jsonb; my int; hand int[]; card int; pot int; cost int; lim int; take boolean;
  n int := jsonb_array_length(s->'players'); fits_opp boolean; min_opp int; k int; ch text; t int := (s->>'turn')::int; pn real;
  opp_cards jsonb; opp_chips int[];
begin
  if s->>'phase' <> 'playing' or p_v is distinct from (s->>'v')::int then return false; end if;
  me := s->'players'->((s->>'turn')::int);
  if not coalesce((me->>'bot')::boolean, false) then return false; end if;
  select chips into my from nothanks_seats where code = c and pid = me->>'pid';
  select coalesce(array_agg(v::int), '{}') into hand from jsonb_array_elements_text(me->'cards') v;
  card := (s->>'card')::int; pot := (s->>'pot')::int;
  select coalesce(bool_or(x->'cards' @> to_jsonb(card - 1) or x->'cards' @> to_jsonb(card + 1)), false),
         coalesce(min((select chips from nothanks_seats z where z.code = c and z.pid = x->>'pid')), 0)
    into fits_opp, min_opp from jsonb_array_elements(s->'players') x where x->>'pid' <> me->>'pid';
  k := nothanks_bot_key(hand, my, card, pot, fits_opp, min_opp, (s->>'left')::int, n);
  if my > 0 then
    select jsonb_agg(s->'players'->((t + i) % n)->'cards' order by i),
           array_agg((select chips from nothanks_seats z where z.code = c and z.pid = s->'players'->((t + i) % n)->>'pid') order by i)
      into opp_cards, opp_chips from generate_series(1, n - 1) i;
    pn := nothanks_net_take(hand, my, card, pot, (s->>'left')::int, n, opp_cards, opp_chips);
  end if;
  select substr(policy, k + 1, 1) into ch from nothanks_policy where id = 1;
  if my = 0 then take := true;
  elsif pn is not null then take := random() < pn;
  elsif ch is not null and ch <> '.' and ch <> '' then
    take := random() < (strpos('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', ch) - 1) / 63.0;
  else
    cost := nothanks_points(hand || card) - nothanks_points(hand) - pot;
    lim := case when my <= 2 then 12 when my <= 4 then 7 when my <= 7 then 3 else 0 end + case when random() < 0.2 then 2 else 0 end;
    take := cost <= lim;
    if take and (card - 1 = any(hand) or card + 1 = any(hand)) and cost <= 0 and pot < n and random() < 0.5 then take := false; end if;   -- milk it
  end if;
  perform nothanks_do(c, s, take);
  return true;
end $$;

-- the host adds a bot to a room that isn't mid-game
create or replace function public.nothanks_add_bot(p_code text, p_token uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb := nothanks_lock(p_code); c text := upper(p_code); p text := substr(md5(gen_random_uuid()::text), 1, 8); n text;
begin
  if s->>'host' is distinct from nothanks_pid(p_code, p_token) then raise exception 'Only the host can add bots.'; end if;
  if s->>'phase' = 'playing' then raise exception 'Wait for this game to finish.'; end if;
  if jsonb_array_length(s->'players') >= 7 then raise exception 'The room is full (7 players).'; end if;
  select x into n from unnest(array['Ada', 'Basil', 'Clem', 'Dot', 'Ezra', 'Fern', 'Gus']) x
    where not exists (select 1 from jsonb_array_elements(s->'players') y where y->>'name' = x || ' (bot)') order by random() limit 1;
  insert into nothanks_seats (code, pid, token) values (c, p, gen_random_uuid());   -- nobody holds a bot's token
  perform nothanks_save(c, jsonb_set(s, '{players}', (s->'players') || jsonb_build_object('pid', p, 'name', n || ' (bot)', 'bot', true, 'cards', '[]'::jsonb)));
end $$;

-- the host removes a bot from a room that isn't mid-game
create or replace function public.nothanks_remove_bot(p_code text, p_token uuid, p_pid text) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb := nothanks_lock(p_code); c text := upper(p_code); ps jsonb;
begin
  if s->>'host' is distinct from nothanks_pid(p_code, p_token) then raise exception 'Only the host can remove bots.'; end if;
  if s->>'phase' = 'playing' then raise exception 'Wait for this game to finish.'; end if;
  if not exists (select 1 from jsonb_array_elements(s->'players') x where x->>'pid' = p_pid and (x->>'bot')::boolean) then return; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into ps from jsonb_array_elements(s->'players') x where x->>'pid' <> p_pid;
  delete from nothanks_seats where code = c and pid = p_pid;
  perform nothanks_save(c, jsonb_set(s, '{players}', ps));
end $$;

-- this browser's seat and chips in a room: {pid, chips}
create or replace function public.nothanks_me(p_code text, p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pid', pid, 'chips', chips) from nothanks_seats where code = upper(p_code) and token = p_token
$$;

-- only the game's calls are open to the browser
revoke execute on function public.nothanks_lock(text), public.nothanks_pid(text, uuid), public.nothanks_save(text, jsonb),
  public.nothanks_name(text), public.nothanks_do(text, jsonb, boolean), public.nothanks_points(int[]),
  public.nothanks_bot_key(int[], int, int, int, boolean, int, int, int),
  public.nothanks_net_dense(real[], int, int, int, real[], int, boolean),
  public.nothanks_net_conv(real[], int, int, int, int, real[], real[], boolean),
  public.nothanks_net_take(int[], int, int, int, int, int, jsonb, int[]) from public, anon, authenticated;
revoke execute on function public.nothanks_create(text, uuid), public.nothanks_join(text, text, uuid), public.nothanks_leave(text, uuid),
  public.nothanks_start(text, uuid), public.nothanks_act(text, uuid, boolean, int), public.nothanks_me(text, uuid),
  public.nothanks_bot(text, int), public.nothanks_add_bot(text, uuid), public.nothanks_remove_bot(text, uuid, text) from public;
grant execute on function public.nothanks_create(text, uuid), public.nothanks_join(text, text, uuid), public.nothanks_leave(text, uuid),
  public.nothanks_start(text, uuid), public.nothanks_act(text, uuid, boolean, int), public.nothanks_me(text, uuid),
  public.nothanks_bot(text, int), public.nothanks_add_bot(text, uuid), public.nothanks_remove_bot(text, uuid, text) to anon, authenticated;
