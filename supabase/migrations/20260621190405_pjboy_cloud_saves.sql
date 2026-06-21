-- PJBoy cloud saves — capability-based per-code save sync.
--
-- A "save" is one row identified by a shareable CODE (e.g. EMBER-FOX-COMET-4821).
-- The code IS the access capability: knowing it lets you read/write that save,
-- which is what lets a player carry one world across localhost, the live site,
-- and other devices. This is deliberately lightweight (kid-friendly sandbox
-- saves, no personal data) — there is no per-user auth.
--
-- Security model:
--   * RLS is ON with NO policies, so the anon/authenticated roles cannot touch
--     the table directly through the Data API (every direct row read returns 0).
--   * All access goes through the two SECURITY DEFINER RPCs below, which run as
--     the function owner (bypassing RLS) but only ever operate on this one table,
--     keyed by the caller-supplied code. search_path is pinned to defeat hijack.
--   * Residual risk: a guessed/leaked code grants access to that one save. Codes
--     carry ~7.7e9 combinations (95^3 words * 9000 digits) and saves are
--     non-sensitive, so
--     this is acceptable for the use case. Add rate-limiting later if needed.

create table if not exists public.saves (
  code        text        primary key,
  data        jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.saves enable row level security;
-- Intentionally no policies: direct PostgREST access is denied for everyone.
-- The SECURITY DEFINER RPCs are the only sanctioned path in.

-- Read a save by its code. Returns the stored profile JSON, or NULL if unknown.
create or replace function public.cloud_pull(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select data from public.saves where code = p_code;
$$;

-- Create-or-update a save by its code. Last write wins. Returns the new updated_at.
create or replace function public.cloud_push(p_code text, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  ts timestamptz;
begin
  if p_code is null or length(p_code) < 8 then
    raise exception 'invalid code';
  end if;
  if p_data is null then
    raise exception 'empty data';
  end if;
  if pg_column_size(p_data) > 2 * 1024 * 1024 then   -- 2 MB cap, abuse guard
    raise exception 'save too large';
  end if;

  insert into public.saves as s (code, data, updated_at)
       values (p_code, p_data, now())
  on conflict (code)
       do update set data = excluded.data, updated_at = now()
    returning s.updated_at into ts;

  return ts;
end;
$$;

-- Lock execution down to the API roles only (functions are granted to PUBLIC by
-- default — revoke that, then grant explicitly).
revoke all on function public.cloud_pull(text)        from public;
revoke all on function public.cloud_push(text, jsonb) from public;
grant execute on function public.cloud_pull(text)        to anon, authenticated;
grant execute on function public.cloud_push(text, jsonb) to anon, authenticated;
