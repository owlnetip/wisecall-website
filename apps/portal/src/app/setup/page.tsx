import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GuestSetup } from "@/components/guest-setup";
import { SignupAttributionCapture } from "@/components/signup-attribution-capture";
import { parseSetupEmail, parseSetupPhone } from "@/lib/guest-auto-ring";
import { attributionFromSearchParams } from "@/lib/signup-attribution";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dashboardSetupPath, parseNoWebsite, parseSetupWebsite } from "@/lib/setup-website";

export const metadata: Metadata = {
  title: "Hear WiseCall",
  description:
    "Enter your UK mobile. We call you so you can hear the receptionist. No account first.",
  robots: { index: false, follow: true },
};

export default async function GuestSetupPage({
  searchParams,
}: {
  searchParams: Promise<{
    website?: string;
    trial?: string;
    phone?: string;
    email?: string;
    nowebsite?: string;
    src?: string;
    lp?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
  }>;
}) {
  const { website, phone, email, nowebsite, src, lp, utm_source, utm_medium, utm_campaign } =
    await searchParams;
  const attribution = attributionFromSearchParams({
    src,
    lp,
    utm_source,
    utm_medium,
    utm_campaign,
  });
  const setupWebsite = parseSetupWebsite(website) ?? "";
  const noWebsite = parseNoWebsite(nowebsite) && !setupWebsite;
  const setupPhone = parseSetupPhone(phone);
  const setupEmail = parseSetupEmail(email);

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect(dashboardSetupPath(setupWebsite || undefined));
    }
  }

  return (
    <>
      <SignupAttributionCapture initial={attribution} />
      <GuestSetup
        initialWebsite={setupWebsite}
        initialPhone={setupPhone}
        initialEmail={setupEmail}
        noWebsite={noWebsite}
      />
    </>
  );
}
