-- Widen the SIP bridge pbx_type to cover Yeastar and Bicom PBXware, which the
-- bridge now has dedicated adapters for (both are standard SIP otherwise).

ALTER TABLE wisecall_sip_endpoints
  DROP CONSTRAINT IF EXISTS wisecall_sip_endpoints_pbx_type_check;

ALTER TABLE wisecall_sip_endpoints
  ADD CONSTRAINT wisecall_sip_endpoints_pbx_type_check
  CHECK (pbx_type IN ('portsip', '3cx', 'mor', 'yeastar', 'bicom', 'generic'));
