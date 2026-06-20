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

  // We need a reply-to address so support can respond. Use the customer's
  // signed-in email; refuse rather than create an unreplyable ticket.
  const fromEmail = user.email;
  if (!fromEmail) {
    return { ok: false as const, error: "No email on your account to reply to." };
  }

  const ticketNumber = `WC-${Date.now()}`;
  const description = [
    message,
    "",
    "—",
    `Raised from the WiseCall portal by ${fromEmail}.`,
  ].join("\n");

  const { data: ticket, error } = await service
    .from("tickets")
    .insert({
      ticket_number: ticketNumber,
      title: subject,
      description,
      status: "open",
      priority: "medium",
      category: "wisecall",
      tags: ["wisecall", "portal"],
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !ticket) {
    console.error("raiseSupportTicket failed:", error?.message);
    return { ok: false as const, error: "Couldn't raise the ticket. Please try again." };
  }

  // Add the opening message as a ticket reply carrying the customer's from_email,
  // so the desk's reply flow knows where to send responses.
  const { error: replyError } = await service.from("ticket_replies").insert({
    ticket_id: ticket.id,
    from_email: fromEmail,
    reply_content: message,
    is_internal: false,
  });
  if (replyError) {
    console.error("raiseSupportTicket reply insert failed:", replyError.message);
    // Ticket still exists; don't fail the whole flow.
  }

  return { ok: true as const, ticketNumber };
}
