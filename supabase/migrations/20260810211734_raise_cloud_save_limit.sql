-- Kid worlds with lots of building were hitting the 2 MB cloud_push guard and
-- the HUD showed a bare "Save failed". Raise the cap so a long claim still syncs.
-- (Abuse guard remains — just sized for real play, not tiny test saves.)

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
  -- 12 MB: ~a few hundred thousand block edits across planets, with headroom.
  if pg_column_size(p_data) > 12 * 1024 * 1024 then
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

revoke all on function public.cloud_push(text, jsonb) from public;
grant execute on function public.cloud_push(text, jsonb) to anon, authenticated;
