import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public, unauthenticated opt-out link embedded in outreach emails
 * (merge field {{unsubscribe_url}}). Setting status to "not_interested"
 * is enough on its own: processDueOutreachFollowUps already skips and
 * cancels any scheduled follow-ups for that status.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const page = (message: string) =>
    new NextResponse(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WiseCall</title></head><body style="margin:0;padding:64px 24px;background:#172929;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-align:center;"><p style="font-size:18px;">${message}</p></body></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  if (!id) return page("Missing unsubscribe link.");

  const service = getServiceSupabase();
  if (!service) return page("Something went wrong. Please contact us directly to opt out.");

  const { error } = await service
    .from("wisecall_outreach_prospects")
    .update({ status: "not_interested", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return page("Something went wrong. Please contact us directly to opt out.");

  return page("You've been unsubscribed and won't receive further emails from WiseCall.");
}
