const INTERNAL_BASE = new URL("https://wisecall.invalid");

export function safeInternalRedirect(
  target: unknown,
  fallback = "/dashboard",
): string {
  if (typeof target !== "string" || !target.startsWith("/") || target.includes("\\")) {
    return fallback;
  }

  try {
    const decoded = decodeURIComponent(target);
    if (decoded.startsWith("//") || decoded.includes("\\")) return fallback;

    const resolved = new URL(target, INTERNAL_BASE);
    if (resolved.origin !== INTERNAL_BASE.origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
