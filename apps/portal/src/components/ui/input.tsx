"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={[
        "w-full rounded-lg border border-line bg-card-tint px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-teal focus:ring-2 focus:ring-teal/30 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/20",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
});
