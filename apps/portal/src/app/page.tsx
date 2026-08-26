"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { resolveAuthLanding } from "@/lib/trial";

function HomeAuth() {
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get("redirect");
  const redirectAfterSignIn =
    redirectParam && redirectParam.startsWith("/") && !redirectParam.startsWith("//")
      ? redirectParam
      : "/dashboard";

  const landing = resolveAuthLanding({
    signup: searchParams.get("signup"),
    trial: searchParams.get("trial"),
    redirect: redirectParam,
    website: searchParams.get("website"),
  });

  return (
    <AuthForm
      mode={landing.mode}
      redirectAfterSignIn={redirectAfterSignIn}
      trial={landing.trial}
      website={landing.website}
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
