"use client";

import { Suspense, useActionState, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authAction, type AuthState } from "@/app/actions/auth";

interface OwlProps {
  eyeOffset: { x: number; y: number };
  passwordFocused: boolean;
  blinking: boolean;
}

function Owl({ eyeOffset, passwordFocused, blinking }: OwlProps) {
  return (
    <svg
      viewBox="0 0 120 140"
      width="120"
      height="140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: "drop-shadow(0 8px 28px rgba(125,232,235,0.2))" }}
    >
      {/* Body */}
      <ellipse cx="60" cy="104" rx="36" ry="38" fill="#1f3535" />
      <ellipse cx="60" cy="112" rx="26" ry="28" fill="#2a4545" />

      {/* Belly */}
      <ellipse cx="60" cy="116" rx="16" ry="18" fill="#7de8eb" opacity="0.15" />

      {/* Ear tufts */}
      <ellipse cx="42" cy="56" rx="7" ry="12" fill="#1f3535" transform="rotate(-16 42 56)" />
      <ellipse cx="78" cy="56" rx="7" ry="12" fill="#1f3535" transform="rotate(16 78 56)" />
      <ellipse cx="42" cy="55" rx="4" ry="7" fill="#2a4545" transform="rotate(-16 42 55)" />
      <ellipse cx="78" cy="55" rx="4" ry="7" fill="#2a4545" transform="rotate(16 78 55)" />

      {/* Head */}
      <circle cx="60" cy="72" r="32" fill="#1f3535" />
      <circle cx="60" cy="72" r="28" fill="#2a4545" />

      {/* Face disc */}
      <ellipse cx="60" cy="75" rx="22" ry="20" fill="#172929" opacity="0.4" />

      {/* Eye rings */}
      <circle cx="46" cy="70" r="12" fill="#172929" />
      <circle cx="74" cy="70" r="12" fill="#172929" />

      {/* Eye whites */}
      <circle cx="46" cy="70" r="10" fill="#ffffff" />
      <circle cx="74" cy="70" r="10" fill="#ffffff" />

      {/* Iris — brand cyan */}
      <circle cx={46 + eyeOffset.x} cy={70 + eyeOffset.y} r="6" fill="#7de8eb" />
      <circle cx={74 + eyeOffset.x} cy={70 + eyeOffset.y} r="6" fill="#7de8eb" />

      {/* Pupil + shine */}
      {!blinking ? (
        <>
          <circle cx={46 + eyeOffset.x} cy={70 + eyeOffset.y} r="3.2" fill="#172929" />
          <circle cx={74 + eyeOffset.x} cy={70 + eyeOffset.y} r="3.2" fill="#172929" />
          <circle cx={47.5 + eyeOffset.x} cy={67.8 + eyeOffset.y} r="1.1" fill="white" opacity="0.85" />
          <circle cx={75.5 + eyeOffset.x} cy={67.8 + eyeOffset.y} r="1.1" fill="white" opacity="0.85" />
        </>
      ) : (
        <>
          <ellipse cx="46" cy="70" rx="10" ry="1.5" fill="#2a4545" />
          <ellipse cx="74" cy="70" rx="10" ry="1.5" fill="#2a4545" />
        </>
      )}

      {/* Beak */}
      <path
        d="M60 79 L56 86 L64 86 Z"
        fill="#7de8eb"
        stroke="#7de8eb"
        strokeWidth="3.5"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <path
        d="M60 83.5 L56 86 L64 86 Z"
        fill="#4db8bb"
        stroke="#4db8bb"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />

      {/* Left wing — swings right up over the eyes on password focus */}
      <g
        style={{
          transformOrigin: "28px 96px",
          transform: passwordFocused
            ? "translate(20px, -30px) rotate(-104deg)"
            : "rotate(0deg)",
          transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <ellipse cx="26" cy="108" rx="14" ry="26" fill="#1f3535" transform="rotate(-10 26 108)" />
        <ellipse cx="24" cy="106" rx="9" ry="19" fill="#2a4545" transform="rotate(-10 24 106)" />
      </g>

      {/* Right wing — swings up over the eyes on password focus */}
      <g
        style={{
          transformOrigin: "92px 96px",
          transform: passwordFocused
            ? "translate(-20px, -30px) rotate(104deg)"
            : "rotate(0deg)",
          transition: "transform 0.5s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <ellipse cx="94" cy="108" rx="14" ry="26" fill="#1f3535" transform="rotate(10 94 108)" />
        <ellipse cx="96" cy="106" rx="9" ry="19" fill="#2a4545" transform="rotate(10 96 106)" />
      </g>

      {/* Branch */}
      <rect x="8" y="136" width="104" height="7" rx="3.5" fill="#2a4545" />

      {/* Feet */}
      <rect x="49" y="135" width="4" height="7" rx="2" fill="#7de8eb" opacity="0.6" transform="rotate(-8 49 135)" />
      <rect x="56" y="136" width="4" height="7" rx="2" fill="#7de8eb" opacity="0.6" />
      <rect x="63" y="136" width="4" height="7" rx="2" fill="#7de8eb" opacity="0.6" />
      <rect x="70" y="135" width="4" height="7" rx="2" fill="#7de8eb" opacity="0.6" transform="rotate(8 70 135)" />
    </svg>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") ?? "/dashboard";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, formAction, isPending] = useActionState<AuthState, FormData>(
    authAction,
    {},
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [eyeOffset, setEyeOffset] = useState({ x: 0, y: 0 });
  const [blinking, setBlinking] = useState(false);
  const owlContainerRef = useRef<HTMLDivElement>(null);
  const isSignup = mode === "signup";

  // Eye tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (passwordFocused || !owlContainerRef.current) return;
      const rect = owlContainerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2 - 20;
      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxOffset = 4;
      const factor = Math.min(dist, 250) / 250;
      setEyeOffset({
        x: dist > 0 ? (dx / dist) * maxOffset * factor : 0,
        y: dist > 0 ? (dy / dist) * maxOffset * factor : 0,
      });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [passwordFocused]);

  // Periodic blink
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      const delay = 2500 + Math.random() * 4000;
      return setTimeout(() => {
        setBlinking(true);
        setTimeout(() => {
          setBlinking(false);
          timerId = scheduleBlink();
        }, 150);
      }, delay);
    };
    timerId = scheduleBlink();
    return () => clearTimeout(timerId);
  }, []);

  useEffect(() => {
    if (passwordFocused) setEyeOffset({ x: 0, y: 0 });
  }, [passwordFocused]);

  return (
    <div
      className="size-full min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "#172929" }}
    >
      {/* Subtle radial glow behind owl/card */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(125,232,235,0.07) 0%, transparent 70%)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -58%)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm mx-4">
        {/* Owl */}
        <div ref={owlContainerRef} className="flex justify-center mb-1">
          <div style={{ animation: "bounceIn 0.55s cubic-bezier(0.34,1.56,0.64,1) both" }}>
            <Owl eyeOffset={eyeOffset} passwordFocused={passwordFocused} blinking={blinking} />
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl px-8 pt-7 pb-8"
          style={{
            background: "#1f3535",
            border: "1px solid rgba(125,232,235,0.14)",
            boxShadow: "0 4px 6px rgba(0,0,0,0.2), 0 24px 48px rgba(0,0,0,0.3)",
          }}
        >
          {/* Header */}
          <div className="text-center mb-7">
            <div className="flex items-center justify-center gap-0 mb-1.5">
              <span
                className="text-2xl font-bold tracking-tight"
                style={{ color: "#ffffff", letterSpacing: "-0.02em" }}
              >
                Wise
              </span>
              <span
                className="text-2xl font-bold tracking-tight"
                style={{ color: "#7de8eb", letterSpacing: "-0.02em" }}
              >
                Call
              </span>
            </div>
            <p className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.72)" }}>
              {isSignup ? "Create your account" : "Sign in to your account"}
            </p>
          </div>

          <form action={formAction} className="space-y-4">
            <input type="hidden" name="intent" value={mode} />
            <input type="hidden" name="redirect" value={redirectTo} />
            {/* Email */}
            <div className="space-y-1.5">
              <label
                className="block text-xs font-semibold"
                style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em", textTransform: "uppercase" }}
              >
                Email
              </label>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@wisecall.io"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200"
                style={{
                  background: "#172929",
                  border: "1.5px solid rgba(125,232,235,0.15)",
                  color: "#ffffff",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#7de8eb";
                  e.target.style.boxShadow = "0 0 0 3px rgba(125,232,235,0.12)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "rgba(125,232,235,0.15)";
                  e.target.style.boxShadow = "none";
                }}
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  className="block text-xs font-semibold"
                  style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em", textTransform: "uppercase" }}
                >
                  Password
                </label>
                <button
                  type="button"
                  className="text-xs font-medium transition-colors duration-150"
                  style={{ color: "#7de8eb", opacity: 0.8 }}
                  onMouseEnter={(e) => ((e.target as HTMLElement).style.opacity = "1")}
                  onMouseLeave={(e) => ((e.target as HTMLElement).style.opacity = "0.8")}
                >
                  Forgot password?
                </button>
              </div>
              <input
                type="password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200"
                style={{
                  background: "#172929",
                  border: "1.5px solid rgba(125,232,235,0.15)",
                  color: "#ffffff",
                }}
                onFocus={(e) => {
                  setPasswordFocused(true);
                  e.target.style.borderColor = "#7de8eb";
                  e.target.style.boxShadow = "0 0 0 3px rgba(125,232,235,0.12)";
                }}
                onBlur={(e) => {
                  setPasswordFocused(false);
                  e.target.style.borderColor = "rgba(125,232,235,0.15)";
                  e.target.style.boxShadow = "none";
                }}
              />
              {passwordFocused && (
                <p
                  className="text-xs mt-1"
                  style={{ color: "rgba(125,232,235,0.6)", fontFamily: "var(--font-geist-mono), monospace" }}
                >
                  🦉 Not peeking, promise.
                </p>
              )}
            </div>

            {/* Error / confirmation message */}
            {state.error && (
              <p
                className="rounded-lg px-3 py-2 text-xs font-medium"
                style={{ background: "rgba(255,99,99,0.12)", color: "#ff9b9b", border: "1px solid rgba(255,99,99,0.25)" }}
              >
                {state.error}
              </p>
            )}
            {state.message && (
              <p
                className="rounded-lg px-3 py-2 text-xs font-medium"
                style={{ background: "rgba(125,232,235,0.12)", color: "#7de8eb", border: "1px solid rgba(125,232,235,0.25)" }}
              >
                {state.message}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-xl py-3 text-sm font-semibold transition-all duration-200 mt-2"
              style={{
                background: isPending ? "rgba(125,232,235,0.5)" : "#7de8eb",
                color: "#172929",
                boxShadow: isPending ? "none" : "0 2px 12px rgba(125,232,235,0.3)",
              }}
              onMouseEnter={(e) => {
                if (!isPending) {
                  (e.currentTarget as HTMLElement).style.background = "#9ef0f2";
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(125,232,235,0.45)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isPending) {
                  (e.currentTarget as HTMLElement).style.background = "#7de8eb";
                  (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(125,232,235,0.3)";
                }
              }}
            >
              {isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {isSignup ? "Creating account…" : "Signing in…"}
                </span>
              ) : isSignup ? (
                "Create account"
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px" style={{ background: "rgba(125,232,235,0.1)" }} />
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
              or
            </span>
            <div className="flex-1 h-px" style={{ background: "rgba(125,232,235,0.1)" }} />
          </div>

          {/* Toggle sign in / sign up */}
          <p className="text-center text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
            {isSignup ? "Already have an account? " : "Don't have an account? "}
            <button
              type="button"
              onClick={() => setMode(isSignup ? "signin" : "signup")}
              className="font-semibold transition-opacity duration-150"
              style={{ color: "#7de8eb" }}
              onMouseEnter={(e) => ((e.target as HTMLElement).style.textDecoration = "underline")}
              onMouseLeave={(e) => ((e.target as HTMLElement).style.textDecoration = "none")}
            >
              {isSignup ? "Sign in" : "Sign up free"}
            </button>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs mt-4" style={{ color: "rgba(255,255,255,0.2)" }}>
          By signing in, you agree to our{" "}
          <span className="underline cursor-pointer" style={{ color: "rgba(255,255,255,0.35)" }}>
            Terms
          </span>{" "}
          and{" "}
          <span className="underline cursor-pointer" style={{ color: "rgba(255,255,255,0.35)" }}>
            Privacy Policy
          </span>
        </p>
      </div>

      <style>{`
        @keyframes bounceIn {
          0% { transform: scale(0.7) translateY(12px); opacity: 0; }
          60% { transform: scale(1.05) translateY(-4px); opacity: 1; }
          80% { transform: scale(0.97) translateY(1px); }
          100% { transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "#172929" }} />}>
      <LoginForm />
    </Suspense>
  );
}
