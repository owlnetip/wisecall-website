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
  const mode =
    searchParams.get("signup") === "1" || searchParams.get("redirect") === "/billing"
      ? "signup"
      : "signin";

  return <AuthForm mode={mode} redirectAfterSignIn={redirectAfterSignIn} />;
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "#172929" }} />}>
      <HomeAuth />
    </Suspense>
  );
}
