-- Tag the public website demo agent (slug wisecall / DDI +441135222277)
-- for Sonic 3.6 + en-GB TTS and Cartesia Ink-2 STT.
--
-- The live Telnyx media path is not in this repository. This only writes
-- metadata the telephony runtime should already (or after this PR will)
-- read. It does not change wisecall_sip_endpoints.stt_provider, because
-- that CHECK currently allows only deepgram / openai_realtime — flipping
-- the column would break SIP agents until Ink-2 is wired in the bridge.

update public.wisecall_profiles
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'tts_provider', 'cartesia',
  'tts_model', 'sonic-preview',
  'tts_locale', 'en-GB',
  'stt_provider', 'cartesia',
  'stt_model', 'ink-2'
)
where slug = 'wisecall';
