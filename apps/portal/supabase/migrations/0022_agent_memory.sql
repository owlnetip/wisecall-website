-- Continuous agent learning: structured "learned memory" per agent.
--
-- Unlike the weekly suggest→manually-apply→append-to-prompt approach, this is
-- the source of truth the prompt's learned block is REBUILT from each sync, so
-- it stays bounded and deduped (no append-forever bloat) and is fully reversible.
--
-- Slice 1 populates one kind: knowledge_gap — a topic callers repeatedly ask
-- about that the agent could not answer. The agent auto-adopts a graceful
-- handling line (take a message, don't guess); the owner can add the real
-- answer (→ status 'answered'), which then becomes factual knowledge. Answers
-- are NEVER AI-generated — only handling behaviour is auto-applied.

create table if not exists wisecall_agent_memory (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null,
  owner_id        uuid not null,
  kind            text not null default 'knowledge_gap',
  topic           text not null,
  -- Representative caller phrasings for this topic (deduped clustering output).
  question_examples jsonb not null default '[]'::jsonb,
  -- Graceful handling line injected into the prompt while the gap is unanswered.
  handling        text,
  -- Owner-provided answer. When set, status flips to 'answered' and this
  -- becomes real knowledge the agent can state. Never written by AI.
  answer          text,
  status          text not null default 'active',
  confidence      text not null default 'medium',
  distinct_calls  integer not null default 0,
  times_seen      integer not null default 0,
  source_call_ids jsonb not null default '[]'::jsonb,
  auto_applied    boolean not null default true,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint wisecall_agent_memory_kind_check
    check (kind in ('knowledge_gap', 'faq', 'fact', 'behaviour', 'screening_signal')),
  constraint wisecall_agent_memory_status_check
    check (status in ('active', 'answered', 'retired')),
  constraint wisecall_agent_memory_confidence_check
    check (confidence in ('high', 'medium', 'low')),
  -- One entry per topic per agent, so re-detection reinforces rather than dupes.
  constraint wisecall_agent_memory_topic_unique
    unique (profile_id, topic)
);

create index if not exists wisecall_agent_memory_owner
  on wisecall_agent_memory (owner_id, status, last_seen_at desc);

create index if not exists wisecall_agent_memory_profile
  on wisecall_agent_memory (profile_id, status, last_seen_at desc);
