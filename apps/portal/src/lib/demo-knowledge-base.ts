import type { KnowledgeBaseCategory } from "@/app/actions/knowledge-base";

export type DemoKnowledgeBaseSource = {
  id: string;
  title: string;
  category: KnowledgeBaseCategory;
  text: string;
};

/** Prefix used in paste titles so demo sources are easy to spot and skip on re-seed. */
export const DEMO_KB_TITLE_PREFIX = "Demo: ";

export const DEMO_KB_SOURCES: DemoKnowledgeBaseSource[] = [
  {
    id: "wisecall-overview",
    title: `${DEMO_KB_TITLE_PREFIX}About WiseCall`,
    category: "General",
    text: `WiseCall is an AI receptionist platform for UK businesses. It answers inbound enquiries across voice, email, WhatsApp, live chat and SMS - 24 hours a day.

Every plan includes the same core platform: AI receptionist, call summaries and transcripts, appointment booking, smart routing and transfers, CRM integrations, dashboard and analytics, knowledge base, AI insights, and SMS notifications.

WiseCall is designed for small businesses through to multi-site teams. Most customers are live within a week after a short onboarding call.

Website: https://www.wisecall.io
Portal: https://app.wisecall.io
Support: hello@wisecall.io`,
  },
  {
    id: "wisecall-pricing",
    title: `${DEMO_KB_TITLE_PREFIX}Pricing & plans`,
    category: "General",
    text: `WiseCall pricing (excl. VAT, 12-month term):

Starter - £99/month
- 100 AI calls / month
- 100 AI email replies / month
- 250 WhatsApp conversations / month
- 100 live chat conversations / month
- 100 SMS messages and notifications / month
- Ideal for small businesses

Professional - £199/month (most popular)
- 300 AI calls / month
- 500 AI email replies / month
- 500 WhatsApp conversations / month
- 500 live chat conversations / month
- 300 SMS messages and notifications / month
- For growing businesses with regular inbound enquiries

Business - £399/month
- 750 AI calls / month
- 2,000 AI email replies / month
- 2,000 WhatsApp conversations / month
- 2,000 live chat conversations / month
- 750 SMS messages and notifications / month
- For busy teams, multi-site businesses and high enquiry volume

All plans include the same platform features - only the monthly usage allowances change.

Free trial: 7 days with up to 20 AI calls during the trial period.

Overage (when included usage is exceeded):
- Starter: £0.65 per additional AI call
- Professional: £0.55 per additional AI call
- Business: £0.45 per additional AI call

Top-up packs are available from the billing page in the portal.`,
  },
  {
    id: "wisecall-channels",
    title: `${DEMO_KB_TITLE_PREFIX}Channels & features`,
    category: "General",
    text: `WiseCall channels:

Voice - AI receptionist answers your business phone number, takes messages, books appointments, answers FAQs from your knowledge base, and can transfer to a human when needed.

Email - AI email assistant reads inbound messages and sends helpful replies using your knowledge base and business rules.

WhatsApp - AI WhatsApp assistant handles customer conversations on your business WhatsApp number.

Live chat - AI live chat widget for your website; conversations appear in the portal alongside calls.

SMS - Outbound SMS notifications and two-way SMS conversations where configured.

Knowledge base - Upload web pages, paste text, or add files. Content is chunked and embedded so the AI can retrieve accurate answers during calls and messages.

AI Insights - Dashboard summaries of sentiment, urgency, outcomes and trends across your conversations.

Integrations - Webhooks and CRM connectors to push leads and conversation summaries into your existing tools.`,
  },
  {
    id: "wisecall-faqs",
    title: `${DEMO_KB_TITLE_PREFIX}FAQs`,
    category: "General",
    text: `Frequently asked questions:

How long does setup take?
Most businesses go live within a week. We help you configure your agent, knowledge base, routing rules and phone numbers during onboarding.

Can WiseCall transfer to a real person?
Yes. You can configure transfer numbers and rules so the AI hands off to your team when appropriate.

Do I need to change my phone number?
No. WiseCall can work with your existing number via call forwarding or SIP/PBX integration depending on your setup.

Is there a contract?
Plans are on a 12-month term, billed monthly. Prices are shown excluding VAT.

What happens if I exceed my plan allowance?
Additional AI calls are charged at your plan's overage rate. Email, WhatsApp, live chat and SMS allowances are shown on the billing page; contact support if you need a higher tier.

Can I try WiseCall before subscribing?
Yes - sign up for a 7-day free trial (up to 20 AI calls) from the portal.

How do I book a demo?
Visit https://www.wisecall.io and book a free 15-minute demo, or email hello@wisecall.io.`,
  },
  {
    id: "wisecall-onboarding",
    title: `${DEMO_KB_TITLE_PREFIX}Getting started`,
    category: "General",
    text: `Getting started with WiseCall:

1. Sign up at https://app.wisecall.io and choose a plan (or start the 7-day trial).
2. Complete your agent profile - business name, greeting, office hours and routing preferences.
3. Add knowledge base content - pricing, services, FAQs and policies so the AI answers accurately.
4. Connect your channels - provision a voice number, SMS, WhatsApp and/or live chat widget as needed.
5. Test - use the portal test tools or call/text your assigned numbers before going live.
6. Go live - forward your main line or publish the live chat widget on your website.

The portal dashboard shows call history, transcripts, contacts, AI insights and billing in one place.

For help during setup, book an onboarding call via the website or email hello@wisecall.io.`,
  },
];

export function isDemoKnowledgeBaseTitle(title: string): boolean {
  return title.startsWith(DEMO_KB_TITLE_PREFIX);
}
