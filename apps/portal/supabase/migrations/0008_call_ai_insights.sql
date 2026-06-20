-- WiseCall AI Insights: per-call AI analysis fields
--
-- Adds the columns the "AI Insights" dashboard reads. All columns are nullable
-- and additive, so this is SAFE to apply on production: the live phone runtime
-- (service role) keeps inserting call rows exactly as before; these fields simply
-- stay NULL until the after-call analysis step (see lib/call-analysis.ts) fills
-- them in. No existing column is altered or dropped.
--
-- `outcome` already exists on wisecall_call_logs (written by the runtime), so it
-- is intentionally NOT redefined here — the AI's own outcome lives inside
-- ai_analysis_json so we never clobber the runtime's value.

alter table public.wisecall_call_logs
  add column if not exists sentiment            text,    -- positive | neutral | negative
  add column if not exists sentiment_score      integer, -- 0..100 (higher = more positive)
  add column if not exists intent_category      text,    -- short, normalised "reason people called"
  add column if not exists urgency              text,    -- low | medium | high
  add column if not exists complaint_detected   boolean,
  add column if not exists lead_detected        boolean,
  add column if not exists booking_detected     boolean,
  add column if not exists unanswered_question  text,    -- the headline question the agent could not answer
  add column if not exists ai_insight_summary   text,    -- one-line manager summary of the call
  add column if not exists ai_analysis_json     jsonb,   -- full strict-JSON analysis (see CallAnalysis type)
  add column if not exists analysed_at          timestamptz;

-- Speeds up the "calls in this profile that still need analysing" backfill query.
create index if not exists wisecall_call_logs_analysed_at_idx
  on public.wisecall_call_logs (analysed_at);

-- Speeds up dashboard aggregation, which always scopes by profile + time window.
create index if not exists wisecall_call_logs_profile_created_idx
  on public.wisecall_call_logs (profile_id, created_at desc);
