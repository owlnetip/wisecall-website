import { randomUUID } from "crypto";
import { getAppBaseUrl, getSmsWebhookUrl } from "@/lib/env";
import { getServiceSupabase } from "@/lib/supabase";
import type { DemoRequestInput } from "@/lib/validation";

export type DemoRequestResult = {
  demoId: string;
  demoUrl: string;
  smsQueued: boolean;
  storageMode: "supabase" | "local-preview";
};

function makeDemoToken() {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

function normalizeBusinessName(input: DemoRequestInput) {
  if (input.businessName) {
    return input.businessName;
  }

  try {
    return new URL(input.websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    return "WiseCall demo agent";
  }
}

export async function createDemoRequest(
  input: DemoRequestInput,
): Promise<DemoRequestResult> {
  const supabase = getServiceSupabase();
  const token = makeDemoToken();
  const businessName = normalizeBusinessName(input);

  let demoId = token;
  let storageMode: DemoRequestResult["storageMode"] = "local-preview";

  if (supabase) {
    const { data, error } = await supabase
      .from("demo_agents")
      .insert({
        public_token: token,
        business_name: businessName,
        website_url: input.websiteUrl,
        industry: input.industry,
        prospect_mobile: input.mobile,
        status: "requested",
      })
      .select("id, public_token")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    demoId = data.public_token || data.id;
    storageMode = "supabase";
  }

  const demoUrl = `${getAppBaseUrl()}/demo/${demoId}`;
  const smsQueued = await queueDemoSms({
    mobile: input.mobile,
    demoUrl,
    businessName,
    industry: input.industry,
    demoId,
  });

  return {
    demoId,
    demoUrl,
    smsQueued,
    storageMode,
  };
}

async function queueDemoSms(payload: {
  mobile: string;
  demoUrl: string;
  businessName: string;
  industry: string;
  demoId: string;
}) {
  const webhookUrl = getSmsWebhookUrl();

  if (!webhookUrl) {
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        message: `Hey, WiseCall here. We created a demo AI phone assistant for ${payload.businessName}. Test it here: ${payload.demoUrl}`,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function getDemoByToken(token: string) {
  const supabase = getServiceSupabase();

  if (!supabase) {
    return {
      public_token: token,
      business_name: "Your WiseCall demo agent",
      website_url: "https://wisecall.io",
      industry: "General",
      status: "local-preview",
      created_at: new Date().toISOString(),
    };
  }

  const { data, error } = await supabase
    .from("demo_agents")
    .select(
      "public_token, business_name, website_url, industry, status, created_at",
    )
    .eq("public_token", token)
    .single();

  if (error) {
    return null;
  }

  return data;
}
