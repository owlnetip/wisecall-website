// Internal forwarder: portal after-call webhook → existing wisecall-demo-sms
// (Ava hangup signup). Does not change that function or its 2277 message.
//
// Auth: Authorization/apikey must be the service-role key. The portal already
// has that; it does not need WISECALL_DEMO_SMS_SECRET on Vercel.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function isAuthorised(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
  if (!serviceKey) return false;
  const authHeader = (req.headers.get("authorization") || "").trim();
  const bearerKey = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const providedKey = (req.headers.get("apikey") || bearerKey).trim();
  return providedKey === serviceKey;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!isAuthorised(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const secret = Deno.env.get("WISECALL_DEMO_SMS_SECRET")?.trim() || "";
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  if (!secret || !supabaseUrl) {
    return json({ error: "Demo hangup SMS is not configured." }, 500);
  }

  const payload = await req.text();
  const response = await fetch(`${supabaseUrl}/functions/v1/wisecall-demo-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-WiseCall-Demo-Secret": secret,
    },
    body: payload,
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      ...corsHeaders,
      "Content-Type": response.headers.get("Content-Type") || "application/json",
    },
  });
});
