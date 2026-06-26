-- WiseCall SIP bridge schema
-- One SIP registration endpoint per WiseCall agent profile.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS wisecall_sip_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES wisecall_profiles(id) ON DELETE CASCADE,
  pbx_type TEXT NOT NULL DEFAULT 'portsip' CHECK (
    pbx_type IN ('portsip', '3cx', 'mor', 'generic')
  ),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sip_username TEXT NOT NULL,
  sip_password TEXT NOT NULL,
  sip_domain TEXT NOT NULL,
  sip_proxy TEXT,
  outbound_proxy TEXT,
  transport TEXT NOT NULL DEFAULT 'udp' CHECK (transport IN ('udp', 'tcp', 'tls')),
  register_interval_sec INTEGER NOT NULL DEFAULT 300,
  codec_preference TEXT[] NOT NULL DEFAULT ARRAY['PCMU', 'PCMA'],
  local_ip TEXT,
  local_port INTEGER NOT NULL DEFAULT 5060,
  rtp_port_min INTEGER NOT NULL DEFAULT 10000,
  rtp_port_max INTEGER NOT NULL DEFAULT 20000,
  stt_provider TEXT NOT NULL DEFAULT 'deepgram' CHECK (
    stt_provider IN ('deepgram', 'openai_realtime')
  ),
  tts_provider TEXT NOT NULL DEFAULT 'cartesia' CHECK (
    tts_provider IN ('cartesia', 'openai', 'deepgram')
  ),
  transfer_mode TEXT NOT NULL DEFAULT 'refer' CHECK (
    transfer_mode IN ('refer', 'blind', 'attended')
  ),
  portsip_tenant_id TEXT,
  portsip_extension_id TEXT,
  mor_device_id TEXT,
  threecx_extension TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(profile_id)
);

CREATE TABLE IF NOT EXISTS wisecall_sip_registration_status (
  endpoint_id UUID PRIMARY KEY REFERENCES wisecall_sip_endpoints(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES wisecall_profiles(id) ON DELETE CASCADE,
  registration_state TEXT NOT NULL DEFAULT 'unknown' CHECK (
    registration_state IN ('unknown', 'registering', 'registered', 'failed', 'disabled')
  ),
  last_register_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  last_error TEXT,
  sip_contact TEXT,
  bridge_instance_id TEXT,
  active_calls INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wisecall_sip_endpoints_enabled
  ON wisecall_sip_endpoints(is_enabled, pbx_type);

CREATE INDEX IF NOT EXISTS idx_wisecall_sip_registration_state
  ON wisecall_sip_registration_status(registration_state, updated_at DESC);

ALTER TABLE wisecall_call_logs
  ADD COLUMN IF NOT EXISTS sentiment TEXT,
  ADD COLUMN IF NOT EXISTS recording_url TEXT,
  ADD COLUMN IF NOT EXISTS recording_duration_sec NUMERIC,
  ADD COLUMN IF NOT EXISTS sip_call_id TEXT,
  ADD COLUMN IF NOT EXISTS pbx_type TEXT,
  ADD COLUMN IF NOT EXISTS endpoint_id UUID REFERENCES wisecall_sip_endpoints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wisecall_call_logs_sip_call_id
  ON wisecall_call_logs(sip_call_id);

CREATE OR REPLACE FUNCTION update_wisecall_sip_updated_at()
RETURNS TRIGGER AS $wisecall_sip$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$wisecall_sip$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_wisecall_sip_endpoints_updated_at ON wisecall_sip_endpoints;
CREATE TRIGGER update_wisecall_sip_endpoints_updated_at
  BEFORE UPDATE ON wisecall_sip_endpoints
  FOR EACH ROW
  EXECUTE FUNCTION update_wisecall_sip_updated_at();

DROP TRIGGER IF EXISTS update_wisecall_sip_registration_status_updated_at ON wisecall_sip_registration_status;
CREATE TRIGGER update_wisecall_sip_registration_status_updated_at
  BEFORE UPDATE ON wisecall_sip_registration_status
  FOR EACH ROW
  EXECUTE FUNCTION update_wisecall_sip_updated_at();

ALTER TABLE wisecall_sip_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE wisecall_sip_registration_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wisecall_sip_endpoints_service ON wisecall_sip_endpoints;
CREATE POLICY wisecall_sip_endpoints_service
  ON wisecall_sip_endpoints FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS wisecall_sip_registration_service ON wisecall_sip_registration_status;
CREATE POLICY wisecall_sip_registration_service
  ON wisecall_sip_registration_status FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

COMMENT ON TABLE wisecall_sip_endpoints IS 'SIP registration credentials and media settings for WiseCall agents (one per profile).';
COMMENT ON TABLE wisecall_sip_registration_status IS 'Live SIP registration state reported by wisecall-sip-bridge instances.';
