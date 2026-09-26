"use client";

import { useEffect, useRef } from "react";
import {
  attributionFromSearchParams,
  rememberStoredAttribution,
  SIGNUP_ATTRIBUTION_STORAGE_KEY,
  type SignupAttribution,
} from "@/lib/signup-attribution";

function rememberInBrowser(initial?: SignupAttribution | null): string {
  if (typeof window === "undefined") return "";
  const fromUrl = attributionFromSearchParams(new URLSearchParams(window.location.search));
  const stored = rememberStoredAttribution(
    window.localStorage.getItem(SIGNUP_ATTRIBUTION_STORAGE_KEY),
    initial ?? fromUrl,
  );
  if (!stored) return "";
  if (window.localStorage.getItem(SIGNUP_ATTRIBUTION_STORAGE_KEY) !== stored) {
    window.localStorage.setItem(SIGNUP_ATTRIBUTION_STORAGE_KEY, stored);
  }
  return stored;
}

// Writes first-touch attribution into localStorage. The httpOnly cookie set in
// middleware is what the server reads; this covers a later signup form in the
// same browser when that cookie is missing.
export function SignupAttributionCapture({ initial = null }: { initial?: SignupAttribution | null }) {
  useEffect(() => {
    rememberInBrowser(initial);
  }, [initial]);
  return null;
}

export function SignupAttributionInput() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const value = rememberInBrowser(null);
    if (ref.current) ref.current.value = value;
  }, []);
  return <input ref={ref} type="hidden" name="attribution" defaultValue="" />;
}
