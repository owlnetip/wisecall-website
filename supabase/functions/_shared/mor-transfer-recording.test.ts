import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  POST_TRANSFER_MARKER,
  formatDeepgramTranscript,
  mergeLiveAndRecordingTranscript,
  morCallEndWebhookUrl,
  parseMorCallEndParams,
  parseMorRecordingsXml,
  phonesMatch,
  pickMorRecording,
  selectMatchingCallLog,
  shouldResendSummaryEmailAfterTransferRecording,
} from "./mor-transfer-recording.ts";

Deno.test("phonesMatch treats E.164 and UK national as the same number", () => {
  assertEquals(phonesMatch("+447958740689", "07958740689"), true);
  assertEquals(phonesMatch("441135220500", "01135220500"), true);
});

Deno.test("mergeLiveAndRecordingTranscript appends the post-transfer recording", () => {
  const merged = mergeLiveAndRecordingTranscript(
    "assistant: I'll put you through now.",
    "user: The boiler is off.",
  );
  assertMatch(merged, /put you through/);
  assertMatch(merged, new RegExp(POST_TRANSFER_MARKER));
  assertMatch(merged, /boiler is off/);
});

Deno.test("parseMorCallEndParams reads MOR query-string webhooks", () => {
  const event = parseMorCallEndParams(
    "token=secret&device_id=88&src=%2B447111111111&dst=07958740689&billsec=120",
  );
  assertEquals(event.deviceId, "88");
  assertEquals(event.src, "+447111111111");
  assertEquals(event.dst, "07958740689");
  assertEquals(event.billsec, 120);
});

Deno.test("pickMorRecording prefers the transfer destination on that SIP device", () => {
  const xml = `<recordings>
    <recording><id>1</id><src_device_id>88</src_device_id><source>+447111111111</source><destination>07900000000</destination><mp3_url>https://mor.example/old.mp3</mp3_url></recording>
    <recording><id>2</id><src_device_id>88</src_device_id><source>+447111111111</source><destination>07958740689</destination><mp3_url>https://mor.example/full.mp3</mp3_url></recording>
  </recordings>`;
  const picked = pickMorRecording(parseMorRecordingsXml(xml), {
    deviceId: "88",
    src: "+447111111111",
    dst: "07958740689",
  });
  assertEquals(picked?.mp3Url, "https://mor.example/full.mp3");
});

Deno.test("selectMatchingCallLog prefers the awaiting transferred call", () => {
  const match = selectMatchingCallLog(
    [
      {
        id: "other",
        caller_id: "+447111111111",
        outcome: "completed",
        started_at: "2026-09-07T08:00:00.000Z",
        metadata: {},
      },
      {
        id: "wait",
        caller_id: "07111111111",
        outcome: "transfer",
        started_at: "2026-09-07T10:00:00.000Z",
        metadata: { awaiting_post_transfer_recording: true },
      },
    ],
    parseMorCallEndParams("device_id=88&src=%2B447111111111"),
    Date.parse("2026-09-07T10:02:00.000Z"),
  );
  assertEquals(match?.id, "wait");
});

Deno.test("summary email can send again after the transfer recording is attached", () => {
  assertEquals(
    shouldResendSummaryEmailAfterTransferRecording({
      summary_email_sent: true,
      summary_email_sent_at: "2026-09-07T10:00:00.000Z",
      post_transfer_recording_attached_at: "2026-09-07T10:02:00.000Z",
    }),
    true,
  );
  assertEquals(
    shouldResendSummaryEmailAfterTransferRecording({
      summary_email_sent: true,
      summary_email_sent_at: "2026-09-07T10:03:00.000Z",
      post_transfer_recording_attached_at: "2026-09-07T10:02:00.000Z",
    }),
    false,
  );
});

Deno.test("morCallEndWebhookUrl is what provision writes onto the SIP device", () => {
  assertEquals(
    morCallEndWebhookUrl("https://example.supabase.co/", "abc"),
    "https://example.supabase.co/functions/v1/wisecall-mor-call-end?token=abc",
  );
});

Deno.test("formatDeepgramTranscript uses utterances when present", () => {
  assertEquals(
    formatDeepgramTranscript({
      results: {
        utterances: [
          { speaker: 0, transcript: "Hello" },
          { speaker: 1, transcript: "Putting you through" },
        ],
      },
    }),
    "speaker 0: Hello\nspeaker 1: Putting you through",
  );
});
