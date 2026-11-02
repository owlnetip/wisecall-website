import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChatToolPayload,
  chatToolDefinitions,
  earlierToolResultsBlock,
  MAX_TOOL_CALLS_PER_CHAT,
  readChatToolHooks,
  readChatToolState,
  runChatTool,
} from "../../../../supabase/functions/_shared/chat-tools";

const book = {
  name: "book",
  url: "https://example.com/hook",
  enabled: true,
  condition: "during_call",
  headers: [{ key: "Authorization", value: "Bearer SECRET" }, { key: "Host", value: "evil" }],
  parameters: [
    { key: "action", value: "book" },
    { key: "profile_id", value: "{{profile_id}}" },
    { key: "start", value: "" },
  ],
};
const other = { ...book, name: "other" };
const metadata = {
  chat_tools: { enabled: true, tools: ["book"] },
  integration_webhooks: [book, other],
};
const context = { profileId: "p1", callId: "c1", callerId: "" };
const reply = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;

test("agents without the flag get no tools", () => {
  assert.deepEqual(readChatToolHooks({ integration_webhooks: [book] }), []);
  assert.deepEqual(readChatToolHooks({ ...metadata, chat_tools: { enabled: false, tools: ["book"] } }), []);
  assert.deepEqual(readChatToolHooks(null), []);
});

test("only allowlisted, enabled, during_call, https hooks are tools", () => {
  assert.deepEqual(readChatToolHooks(metadata).map((h) => h.name), ["book"]);
  for (const bad of [{ enabled: false }, { condition: "after_call" }, { url: "http://example.com" }]) {
    const hooks = [{ ...book, ...bad }];
    assert.deepEqual(readChatToolHooks({ ...metadata, integration_webhooks: hooks }), []);
  }
});

test("definitions expose only the model-filled parameters and never headers", () => {
  const [definition] = chatToolDefinitions(readChatToolHooks(metadata));
  assert.deepEqual(Object.keys(definition.function.parameters.properties), ["start"]);
  assert.ok(!JSON.stringify(definition).includes("SECRET"));
});

test("the model cannot override fixed parameters", () => {
  const payload = buildChatToolPayload(book, context, { action: "cancel", start: "2026-11-04T10:00:00Z", extra: "x" });
  assert.deepEqual(payload, {
    profileId: "p1", callId: "c1", callerId: "", action: "book", profile_id: "p1", start: "2026-11-04T10:00:00Z",
  });
});

test("sends hook headers minus forbidden ones, and refuses redirects", async () => {
  let seen: RequestInit | undefined;
  const fetcher = (async (_url: string, init: RequestInit) => {
    seen = init;
    return new Response("{}");
  }) as unknown as typeof fetch;
  await runChatTool([book], [], "book", "{}", context, readChatToolState(null), fetcher);
  const headers = seen?.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer SECRET");
  assert.equal(headers.Host, undefined);
  assert.equal(seen?.redirect, "error");
});

test("a tool outside the hook list does not run", async () => {
  const state = readChatToolState(null);
  const result = await runChatTool([book], [], "other", "{}", context, state, reply("{}"));
  assert.equal(result.ok, false);
  assert.equal(state.calls, 0);
});

test("a one-shot tool runs once after success", async () => {
  const state = readChatToolState(null);
  assert.equal((await runChatTool([book], ["book"], "book", "{}", context, state, reply('{"confirmed":true}'))).ok, true);
  const second = await runChatTool([book], ["book"], "book", "{}", context, state, reply("{}"));
  assert.equal(second.ok, false);
  assert.equal(state.calls, 1);
});

test("a clean refusal leaves a one-shot tool available (slot just taken)", async () => {
  const state = readChatToolState(null);
  await runChatTool([book], ["book"], "book", "{}", context, state, reply('{"ok":false}', 409));
  assert.deepEqual(state.completed, []);
  await runChatTool([book], ["book"], "book", "{}", context, state, reply('{"ok":false}'));
  assert.deepEqual(state.completed, []);
});

test("an unknown outcome blocks a retry of a one-shot tool", async () => {
  const state = readChatToolState(null);
  const boom = (async () => { throw new Error("timeout"); }) as typeof fetch;
  const result = await runChatTool([book], ["book"], "book", "{}", context, state, boom);
  assert.equal(result.ok, false);
  assert.deepEqual(state.completed, ["book"]);
  assert.ok((earlierToolResultsBlock(state) ?? "").includes("unknown"));
  const retry = await runChatTool([book], ["book"], "book", "{}", context, state, reply('{"confirmed":true}'));
  assert.equal(retry.ok, false);
  assert.ok(retry.error?.includes("do not say it worked"));
});

test("the per-chat call limit holds", async () => {
  const state = { ...readChatToolState(null), calls: MAX_TOOL_CALLS_PER_CHAT };
  const result = await runChatTool([book], [], "book", "{}", context, state, reply("{}"));
  assert.equal(result.ok, false);
  assert.equal(state.calls, MAX_TOOL_CALLS_PER_CHAT);
});

test("results survive to the next turn through saved state, without secrets", async () => {
  const state = readChatToolState(null);
  await runChatTool([book], [], "book", "{}", context, state, reply('{"slots":["2026-11-04T10:00:00.000Z"]}'));
  const restored = readChatToolState(JSON.parse(JSON.stringify({ chat_tool_state: state })));
  const block = earlierToolResultsBlock(restored) ?? "";
  assert.ok(block.includes("2026-11-04T10:00:00.000Z"));
  assert.ok(!JSON.stringify(state).includes("SECRET"));
  assert.equal(earlierToolResultsBlock(readChatToolState(null)), null);
});
