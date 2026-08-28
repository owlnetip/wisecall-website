/**
 * Public POST /api/setup-callback for wisecall.io/setup.
 *
 * Validates a UK mobile, rate-limits junk Facebook clicks, then reuses the
 * existing test-agent outbound callback (portal /api/demo-callback →
 * wisecall-demo-callback, profile_slug "wisecall").
 */
import { applySetupCallbackResult, runSetupCallback } from "../lib/setup-callback.js";

export default async function handler(req, res) {
  const result = await runSetupCallback(req);
  applySetupCallbackResult(res, result);
}
