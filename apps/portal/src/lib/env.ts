export function getAppBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return { url, serviceRoleKey };
}

export function getDemoCallbackEndpoint() {
  return (
    process.env.WISECALL_DEMO_CALLBACK_ENDPOINT ||
    "https://zgzzpwaqqftmugzpccpm.supabase.co/functions/v1/wisecall-demo-callback"
  );
}

export function getSmsWebhookUrl() {
  return process.env.WISECALL_DEMO_SMS_WEBHOOK_URL || null;
}
