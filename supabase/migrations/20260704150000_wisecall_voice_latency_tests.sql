-- Voice-agent latency test harness: batch runs, per-call results, per-turn metrics.
-- Populated by the MOR/SIP test caller CLI and the live SIP bridge middleware.

create table if not exists voice_latency_test_runs (
  id                uuid primary key default gen_random_uuid(),
  scenario          text not null,
  target_number     text not null,
  caller_number     text,
  profile_id        uuid,
  status            text not null default 'running',
  calls_planned     int not null default 1,
  calls_completed   int not null default 0,
  p50_ms            int,
  p95_ms            int,
  p99_ms            int,
  avg_stt_ms        int,
  avg_llm_ms        int,
  avg_tts_ms        int,
  avg_sip_ms        int,
  verdict           text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  constraint voice_latency_test_runs_status_check
    check (status in ('running', 'completed', 'failed', 'cancelled')),
  constraint voice_latency_test_runs_verdict_check
    check (verdict is null or verdict in ('PASS', 'WARN', 'FAIL'))
);

create table if not exists voice_latency_tests (
  id                        uuid primary key default gen_random_uuid(),
  test_run_id               uuid references voice_latency_test_runs(id) on delete cascade,
  call_id                   text,
  call_log_id               uuid,
  mor_call_ref              text,
  sip_call_id               text,
  recording_url             text,
  status                    text not null default 'pending',
  p50_turn_latency_ms       int,
  p95_turn_latency_ms       int,
  max_silence_gap_ms        int,
  started_at                timestamptz,
  ended_at                  timestamptz,
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now(),
  constraint voice_latency_tests_status_check
    check (status in ('pending', 'in_progress', 'completed', 'failed', 'no_server_metrics'))
);

-- Per-turn metrics (client + server pipeline timestamps).
create table if not exists voice_latency_test_turns (
  id                        uuid primary key default gen_random_uuid(),
  test_id                   uuid references voice_latency_tests(id) on delete cascade,
  test_run_id               uuid references voice_latency_test_runs(id) on delete cascade,
  call_id                   text not null,
  turn_id                   int not null,
  prompt_text               text,
  -- Client-side (SIPp caller / recording analysis)
  caller_audio_started_at   timestamptz,
  caller_audio_ended_at     timestamptz,
  ai_audio_first_started_at timestamptz,
  client_response_latency_ms int,
  silence_gaps_over_700ms   int not null default 0,
  -- Server-side (SIP bridge middleware)
  audio_received_at         timestamptz,
  deepgram_first_partial_at timestamptz,
  deepgram_final_at         timestamptz,
  openai_request_started_at timestamptz,
  openai_first_token_at     timestamptz,
  cartesia_request_started_at timestamptz,
  cartesia_first_audio_at   timestamptz,
  audio_sent_to_sip_at      timestamptz,
  total_turn_latency_ms     int,
  stt_ms                    int,
  llm_ms                    int,
  tts_ms                    int,
  sip_ms                    int,
  created_at                timestamptz not null default now(),
  unique (call_id, turn_id)
);

create index if not exists voice_latency_test_runs_created
  on voice_latency_test_runs (created_at desc);

create index if not exists voice_latency_tests_run_id
  on voice_latency_tests (test_run_id, created_at desc);

create index if not exists voice_latency_tests_call_id
  on voice_latency_tests (call_id)
  where call_id is not null;

create index if not exists voice_latency_test_turns_run_id
  on voice_latency_test_turns (test_run_id, created_at desc);

create index if not exists voice_latency_test_turns_call_id
  on voice_latency_test_turns (call_id, turn_id);

alter table voice_latency_test_runs enable row level security;
alter table voice_latency_tests enable row level security;
alter table voice_latency_test_turns enable row level security;

-- Service role only (same pattern as wisecall_sip_endpoints).
create policy voice_latency_test_runs_service on voice_latency_test_runs
  for all using (auth.role() = 'service_role');

create policy voice_latency_tests_service on voice_latency_tests
  for all using (auth.role() = 'service_role');

create policy voice_latency_test_turns_service on voice_latency_test_turns
  for all using (auth.role() = 'service_role');
