"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthForm } from "@/components/auth-form";

function SignupAuth() {
  const searchParams = useSearchParams();
  return <AuthForm mode="signup" trial="calls" website={searchParams.get("website") ?? undefined} />;
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "#172929" }} />}>
      <SignupAuth />
    </Suspense>
  );
}
