"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";

// Raises a support ticket into the shared Owlnet ticket desk (public.tickets).
// created_by has no FK constraint, so we stamp the WiseCall customer's own user id
// and put their email + context in the body. Shows up as an open "wisecall" ticket.
export async function raiseSupportTicket(input: { subject: string; message: string }) {
  const subject = (input.subject || "").trim();
  const message = (input.message || "").trim();
  if (!subject || !message) {
    return { ok: false as const, error: "Add a subject and a message." };
  }

  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  const service = getServiceSupabase();
  if (!service) return { ok: false as const, error: "Server not configured." };

  const ticketNumber = `WC-${Date.now()}`;
  const description = [
    message,
    "",
    "—",
    `Raised from the WiseCall portal by ${user.email ?? user.id}.`,
  ].join("\n");

  const { error } = await service.from("tickets").insert({
    ticket_number: ticketNumber,
    title: subject,
    description,
    status: "open",
    priority: "medium",
    category: "wisecall",
    tags: ["wisecall", "portal"],
    created_by: user.id,
  });

  if (error) {
    console.error("raiseSupportTicket failed:", error.message);
    return { ok: false as const, error: "Couldn't raise the ticket. Please try again." };
  }

  return { ok: true as const, ticketNumber };
}
