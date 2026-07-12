alter table public.wisecall_outbound_blasts
  add column if not exists idempotency_key text;

create unique index if not exists wisecall_outbound_blasts_profile_idempotency_key_idx
  on public.wisecall_outbound_blasts (profile_id, idempotency_key)
  where idempotency_key is not null;
