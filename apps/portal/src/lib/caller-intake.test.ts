import assert from "node:assert/strict";
import { test } from "node:test";
import { CALLER_INTAKE_PROMPT, buildCallerIntakeSection } from "./caller-intake";

test("intake confirmation includes the caller's company", () => {
  assert.match(CALLER_INTAKE_PROMPT, /\[Name\] from \[Company\]/);
  assert.match(CALLER_INTAKE_PROMPT, /Which company are you calling from/);
  assert.match(CALLER_INTAKE_PROMPT, /out-of-hours messages always ask/);
});

test("intake section is appended unless explicitly disabled", () => {
  const on = buildCallerIntakeSection({ callerId: "07825395792" });
  assert.ok(on && on.includes("[CALLER ID]"));
  assert.ok(on.includes("from [Company]"));
  assert.equal(
    buildCallerIntakeSection({ metadata: { caller_intake_enabled: false } }),
    null,
  );
});
