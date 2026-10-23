import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applySiteBranding, chatSiteForPageUrl, pageUrlFromRequest } from "./chat-site-brand.ts";

const PROFILE = {
  id: "p1",
  business_name: "Bettermove",
  receptionist_name: "Gemma",
  metadata: {
    chat_assistant_name: "Betty",
    chat_greeting: "Hi, I'm Betty, Bettermove's AI Assistant.",
    chat_accent_color: "#ffffff",
    chat_logo_url: "https://www.bettermove.co.uk/logo.svg",
    chat_font_family: "Lexend",
    chat_launcher_label: "Chat with us",
    chat_instructions: "Your name is Betty, Bettermove's AI Assistant.",
    salesforce_leads: { enabled: true },
    chat_sites: {
      "yorkshirepropertybuyers.co.uk": {
        brand_name: "Yorkshire Property Buyers",
        accent_color: "#112233",
        logo_url: "https://www.yorkshirepropertybuyers.co.uk/logo.png",
      },
      "quick-housebuyers.co.uk": { brand_name: "Quick House Buyers", assistant_name: "Quinn" },
      "WWW.broken.co.uk": { accent_color: "#000" },
    },
  },
};

Deno.test("site matches host, www and subdomains; others and bad entries do not", () => {
  const m = PROFILE.metadata;
  assertEquals(chatSiteForPageUrl(m, "https://www.yorkshirepropertybuyers.co.uk/x")?.site.brand_name, "Yorkshire Property Buyers");
  assertEquals(chatSiteForPageUrl(m, "https://yorkshirepropertybuyers.co.uk/")?.host, "yorkshirepropertybuyers.co.uk");
  assertEquals(chatSiteForPageUrl(m, "https://blog.quick-housebuyers.co.uk/")?.site.brand_name, "Quick House Buyers");
  assertEquals(chatSiteForPageUrl(m, "https://www.bettermove.co.uk/"), null);
  assertEquals(chatSiteForPageUrl(m, "https://notquick-housebuyers.co.uk/"), null);
  assertEquals(chatSiteForPageUrl(m, "https://broken.co.uk/"), null); // no brand_name
  assertEquals(chatSiteForPageUrl(m, ""), null);
});

Deno.test("a matched site replaces brand identity instead of inheriting Bettermove's", () => {
  const out = applySiteBranding(PROFILE, "https://www.yorkshirepropertybuyers.co.uk/");
  const md = out.metadata as Record<string, unknown>;
  assertEquals(out.site_branded, true);
  assertEquals(out.business_name, "Yorkshire Property Buyers");
  assertEquals(out.id, "p1");
  assertEquals(md.chat_assistant_name, "Betty");
  assertEquals(md.chat_greeting, "Hi, I'm Betty, Yorkshire Property Buyers's AI Assistant. How can I help today?");
  assertEquals(md.chat_accent_color, "#112233");
  assertEquals(md.chat_logo_url, "https://www.yorkshirepropertybuyers.co.uk/logo.png");
  assertEquals(md.chat_font_family, undefined);
  assertEquals(md.chat_launcher_label, "Chat with us");
  assertEquals((md.salesforce_leads as any).enabled, true);
  assert(String(md.chat_instructions).startsWith("On this website you are Betty, the AI Assistant for Yorkshire Property Buyers."));
  assert(String(md.chat_instructions).includes("Your name is Betty, Bettermove's AI Assistant."));
  assertEquals(PROFILE.business_name, "Bettermove"); // original untouched
});

Deno.test("site assistant name wins; the agent's own site is untouched", () => {
  const q = applySiteBranding(PROFILE, "https://quick-housebuyers.co.uk/");
  assertEquals((q.metadata as any).chat_assistant_name, "Quinn");
  assertEquals(applySiteBranding(PROFILE, "https://www.bettermove.co.uk/"), PROFILE);
});

Deno.test("page url falls back to Referer then Origin when the widget sent none", () => {
  const req = (h: Record<string, string>) => new Request("https://x.test", { headers: h });
  assertEquals(pageUrlFromRequest(req({ referer: "https://a.co.uk/p", origin: "https://a.co.uk" }), "https://sent.co.uk/"), "https://sent.co.uk/");
  assertEquals(pageUrlFromRequest(req({ referer: "https://a.co.uk/p" })), "https://a.co.uk/p");
  assertEquals(pageUrlFromRequest(req({ origin: "https://a.co.uk" })), "https://a.co.uk");
  assertEquals(pageUrlFromRequest(req({})), "");
});
