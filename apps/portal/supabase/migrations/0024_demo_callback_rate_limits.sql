create table if not exists public.wisecall_demo_callback_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now()
);

create index if not exists wisecall_demo_callback_rate_limits_window_idx
  on public.wisecall_demo_callback_rate_limits (window_started_at);

revoke all on table public.wisecall_demo_callback_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.wisecall_demo_callback_rate_limits to service_role;

create or replace function public.wisecall_consume_demo_callback_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_request_count integer;
  v_retry_after_seconds integer;
begin
  if length(p_rate_key) < 8 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid demo callback rate-limit arguments';
  end if;

  delete from public.wisecall_demo_callback_rate_limits
  where window_started_at < v_now - interval '7 days';

  insert into public.wisecall_demo_callback_rate_limits as limits (
    rate_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (p_rate_key, v_now, 1, v_now)
  on conflict (rate_key) do update
  set
    window_started_at = case
      when limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
      else limits.request_count + 1
    end,
    updated_at = v_now
  returning window_started_at, request_count
  into v_window_started_at, v_request_count;

  v_retry_after_seconds := greatest(
    1,
    ceil(extract(epoch from (v_window_started_at + make_interval(secs => p_window_seconds) - v_now)))::integer
  );

  return jsonb_build_object(
    'allowed', v_request_count <= p_limit,
    'retry_after_seconds', v_retry_after_seconds
  );
end;
$$;

revoke all on function public.wisecall_consume_demo_callback_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.wisecall_consume_demo_callback_rate_limit(text, integer, integer)
  to service_role;
