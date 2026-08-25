"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth-form";

function HomeAuth() {
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get("redirect");
  const redirectAfterSignIn =
    redirectParam && redirectParam.startsWith("/") && !redirectParam.startsWith("//")
      ? redirectParam
      : "/dashboard";

  // Legacy ?signup=1 links still work; otherwise this is the sign-in page.
  // ?trial=calls is the Facebook / Try-it-now path: 20 free calls, no card.
  const trialParam = searchParams.get("trial");
  const noCardTrial = trialParam === "calls";
  const websiteParam = searchParams.get("website") ?? undefined;
  const mode =
    searchParams.get("signup") === "1" ||
    searchParams.get("redirect") === "/billing" ||
    noCardTrial
      ? "signup"
      : "signin";

  return (
    <AuthForm
      mode={mode}
      redirectAfterSignIn={redirectAfterSignIn}
      trial={noCardTrial ? "calls" : undefined}
      website={websiteParam}
    />
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "#172929" }} />}>
      <HomeAuth />
    </Suspense>
  );
}
