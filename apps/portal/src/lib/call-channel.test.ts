import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CALL_CHANNELS,
  CHANNEL_LOG_MATRIX,
  channelFromLog,
  type CallChannel,
} from "./call-channel";

test("channel matrix covers every WiseCall inbox channel exactly once", () => {
  assert.deepEqual(
    CHANNEL_LOG_MATRIX.map((row) => row.channel).sort(),
    [...CALL_CHANNELS].sort(),
  );
  for (const row of CHANNEL_LOG_MATRIX) {
    assert.equal(row.metadataChannel, row.channel);
    assert.ok(row.writer.length > 0);
  }
});

test("stamped metadata.channel wins for every product channel", () => {
  const cases: Array<[CallChannel, Record<string, unknown>]> = [
    ["phone", { channel: "phone" }],
    ["whatsapp", { channel: "whatsapp" }],
    ["sms", { channel: "sms" }],
    ["email", { channel: "email" }],
    ["chat", { channel: "chat" }],
  ];
  for (const [channel, metadata] of cases) {
    assert.equal(channelFromLog({ metadata }), channel, channel);
  }
});

test("legacy rows without metadata.channel still classify correctly", () => {
  assert.equal(
    channelFromLog({ outcome: "WhatsApp replied", summary: "WhatsApp: hello" }),
    "whatsapp",
  );
  assert.equal(channelFromLog({ outcome: "SMS replied", summary: "SMS: running late" }), "sms");
  assert.equal(channelFromLog({ outcome: "Email replied", summary: "Email: quote" }), "email");
  assert.equal(
    channelFromLog({
      outcome: "live_chat",
      metadata: { source: "wisecall-live-chat" },
    }),
    "chat",
  );
  assert.equal(channelFromLog({ outcome: "live_chat_ended" }), "chat");
  assert.equal(channelFromLog({ outcome: "completed", summary: "Booked a viewing" }), "phone");
});

test("unknown channel tags do not invent a channel; voice remains the default", () => {
  assert.equal(channelFromLog({ metadata: { channel: "carrier-pigeon" } }), "phone");
  assert.equal(channelFromLog({}), "phone");
});
