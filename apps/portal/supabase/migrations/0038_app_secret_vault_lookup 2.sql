-- Supabase Vault lookup for edge functions (no 100-secret limit, encrypted at rest).
-- Only service_role may call it; anon/authenticated are explicitly revoked.
-- Store a secret:  select vault.create_secret('<value>', '<NAME>', '<description>');
-- Rotate:          select vault.update_secret((select id from vault.secrets where name = '<NAME>'), '<new value>');
CREATE OR REPLACE FUNCTION public.get_app_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_app_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_app_secret(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_secret(text) TO service_role;
