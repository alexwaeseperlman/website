-- Read-only feed for the live training dashboard (public/train/). Training boxes upload logs and checkpoints into
-- nothanks_train_upload through the token-checked nothanks_train_put; this exposes the text rows to the page.
-- Setup logs are withheld (they echo the upload token under set -x), checkpoint bodies (*.json) are left out, and
-- any long hex string is masked as a second guard.
create table if not exists public.nothanks_train_upload (name text primary key, body text, at timestamptz not null default now());
alter table public.nothanks_train_upload enable row level security;

create or replace function public.train_dash()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', name, 'at', at, 'size', length(body),
    'body', case when name ~ 'setup' or name ~ '\.json$' then null
                 else regexp_replace(right(body, 1000000), '[0-9a-fA-F]{48,}', '[masked]', 'g') end
  ) order by at), '[]'::jsonb)
  from public.nothanks_train_upload
$$;
revoke all on function public.train_dash() from public;
grant execute on function public.train_dash() to anon, authenticated;
