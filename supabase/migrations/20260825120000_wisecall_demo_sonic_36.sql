-- Tag only the public website demo agent (slug wisecall / DDI +441135222277)
-- with Cartesia Sonic 3.6. Do not flip every production agent.
--
-- The live Telnyx media path is not in this repository. This writes
-- metadata.tts_model as a per-profile hook. If the telephony process only
-- reads CARTESIA_MODEL from the environment, set CARTESIA_MODEL=sonic-3.6
-- (or sonic-preview) on that host — that would be host-wide, not demo-only.
--
-- Ink-2 is a separate Cartesia STT swap and is not a Deepgram drop-in.
-- This migration does not change stt_provider / stt_model.

update public.wisecall_profiles
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'tts_provider', 'cartesia',
  'tts_model', 'sonic-3.6'
)
where slug = 'wisecall'
   or regexp_replace(coalesce(telnyx_number, ''), '\D', '', 'g') in (
     '441135222277',
     '01135222277'
   );
