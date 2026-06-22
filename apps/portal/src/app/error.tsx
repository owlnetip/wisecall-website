"use client";

import { RouteError } from "@/components/route-error";

// App-wide fallback for any route without its own error boundary.
export default function AppError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} />;
}
