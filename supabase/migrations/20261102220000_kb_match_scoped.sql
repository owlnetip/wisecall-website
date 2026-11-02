-- wisecall_kb_match asks the shared ivfflat index first and filters by agent after,
-- so an agent whose rows aren't in the probed list gets nothing, and wisecall-kb-search
-- then fell back to downloading up to 750 full embeddings (25s+ for Bettermove).
-- This filters by agent first (GIN on bot_ids) and ranks exactly.
-- MATERIALIZED stops the planner choosing the ivfflat index again.
create or replace function public.wisecall_kb_match_scoped(
  p_embedding text,
  p_bot_id text,
  p_match_count integer default 4
)
returns table (content text, title text, similarity double precision)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as materialized (
    select kb.content, kb.title, kb.embedding
    from public.knowledge_base kb
    where kb.bot_ids @> array[p_bot_id::uuid] and kb.embedding is not null
  )
  select s.content, s.title, 1 - (s.embedding <=> p_embedding::vector) as similarity
  from scoped s
  order by s.embedding <=> p_embedding::vector
  limit p_match_count;
$$;

revoke execute on function public.wisecall_kb_match_scoped(text, text, integer) from public, anon, authenticated;
grant execute on function public.wisecall_kb_match_scoped(text, text, integer) to service_role;
