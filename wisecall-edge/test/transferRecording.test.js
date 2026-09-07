const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  POST_TRANSFER_MARKER,
  isMorSipProfile,
  isPostTransferRecordingEnabled,
  shouldDeferHangupSideEffects,
  phonesMatch,
  mergeLiveAndRecordingTranscript,
  parseMorRecordingsXml,
  pickMorRecording,
  parseMorCallEndParams,
  morCallEndWebhookUrl,
  selectMatchingCallLog,
  withAwaitingTransferMetadata,
  withAttachedRecordingMetadata,
  formatDeepgramTranscript,
  shouldResendSummaryEmailAfterTransferRecording,
} = require("../src/lib/transferRecording");

const morProfile = {
  metadata: { routing: { provider: "mor_sip", number: "+441135220500" } },
};

test("MOR SIP transfers defer hangup email/analysis; Telnyx does not", () => {
  assert.equal(isMorSipProfile(morProfile), true);
  assert.equal(isPostTransferRecordingEnabled(morProfile), true);
  assert.equal(shouldDeferHangupSideEffects(morProfile, "transfer"), true);
  assert.equal(shouldDeferHangupSideEffects(morProfile, "transferred"), true);
  assert.equal(shouldDeferHangupSideEffects(morProfile, "caller_stop"), false);
  assert.equal(
    shouldDeferHangupSideEffects(
      { metadata: { routing: { provider: "telnyx" } } },
      "transfer",
    ),
    false,
  );
});

test("a profile can opt out of MOR post-transfer recording", () => {
  assert.equal(
    isPostTransferRecordingEnabled({
      metadata: { routing: { provider: "mor_sip", record_after_transfer: false } },
    }),
    false,
  );
});

test("phonesMatch treats E.164 and UK national as the same mobile", () => {
  assert.equal(phonesMatch("+447958740689", "07958740689"), true);
  assert.equal(phonesMatch("441135220500", "01135220500"), true);
  assert.equal(phonesMatch("+447958740689", "+447900000000"), false);
});

test("mergeLiveAndRecordingTranscript appends only the new post-transfer audio", () => {
  const live = "assistant: I'll put you through now.\nuser: Thanks.";
  const recording = "user: Hi, it's about the keys.\nassistant: I'll send someone.";
  const merged = mergeLiveAndRecordingTranscript(live, recording);
  assert.match(merged, /I'll put you through now/);
  assert.match(merged, new RegExp(POST_TRANSFER_MARKER));
  assert.match(merged, /about the keys/);
});

test("mergeLiveAndRecordingTranscript prefers a full-call recording over a cut live transcript", () => {
  const live = "assistant: Hello, WiseCall.\nuser: Put me through to Rhys.";
  const recording = `${live}\nuser: The boiler is off.\nassistant: I'll note that.`;
  assert.equal(mergeLiveAndRecordingTranscript(live, recording), recording);
});

test("parseMorCallEndParams reads MOR query-string webhooks", () => {
  const event = parseMorCallEndParams(
    "https://example.supabase.co/functions/v1/wisecall-mor-call-end?token=secret&user_id=9&device_id=88&src=%2B447958740689&dst=07900000000&billsec=96&calltime=2026-09-07T10%3A00%3A00.000%2B00%3A00",
  );
  assert.equal(event.deviceId, "88");
  assert.equal(event.src, "+447958740689");
  assert.equal(event.dst, "07900000000");
  assert.equal(event.billsec, 96);
  assert.equal(event.token, "secret");
});

test("parseMorRecordingsXml picks the matching device/destination recording", () => {
  const xml = `<?xml version="1.0"?>
<page><status><recordings>
  <recording>
    <id>1</id>
    <src_device_id>88</src_device_id>
    <source>+447958740689</source>
    <destination>07900000000</destination>
    <duration>12</duration>
    <mp3_url>https://mor.example/old.mp3</mp3_url>
  </recording>
  <recording>
    <id>2</id>
    <src_device_id>88</src_device_id>
    <source>+447958740689</source>
    <destination>07958740689</destination>
    <duration>90</duration>
    <mp3_url>https://mor.example/full.mp3</mp3_url>
  </recording>
</recordings></status></page>`;
  const picked = pickMorRecording(parseMorRecordingsXml(xml), {
    deviceId: "88",
    src: "+447958740689",
    dst: "07958740689",
  });
  assert.ok(picked);
  assert.equal(picked.mp3Url, "https://mor.example/full.mp3");
});

test("selectMatchingCallLog prefers an awaiting transferred MOR call", () => {
  const logs = [
    {
      id: "old",
      caller_id: "+447958740689",
      outcome: "completed",
      started_at: "2026-09-07T08:00:00.000Z",
      metadata: { channel: "phone" },
    },
    {
      id: "wait",
      caller_id: "07958740689",
      outcome: "transfer",
      started_at: "2026-09-07T10:00:00.000Z",
      metadata: { awaiting_post_transfer_recording: true },
    },
  ];
  const match = selectMatchingCallLog(logs, { src: "+447958740689" }, Date.parse("2026-09-07T10:02:00.000Z"));
  assert.equal(match.id, "wait");
});

test("morCallEndWebhookUrl is the hook provision writes onto the SIP device", () => {
  assert.equal(
    morCallEndWebhookUrl("https://example.supabase.co/", "abc"),
    "https://example.supabase.co/functions/v1/wisecall-mor-call-end?token=abc",
  );
});

test("summary email can send again after the transfer recording is attached", () => {
  assert.equal(
    shouldResendSummaryEmailAfterTransferRecording({
      summary_email_sent: true,
      summary_email_sent_at: "2026-09-07T10:00:00.000Z",
      post_transfer_recording_attached_at: "2026-09-07T10:02:00.000Z",
    }),
    true,
  );
  assert.equal(
    shouldResendSummaryEmailAfterTransferRecording({
      summary_email_sent: true,
      summary_email_sent_at: "2026-09-07T10:03:00.000Z",
      post_transfer_recording_attached_at: "2026-09-07T10:02:00.000Z",
    }),
    false,
  );
});

test("formatDeepgramTranscript uses utterances when present", () => {
  assert.equal(
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

test("recording metadata stamps the await/attach flags the live path reads", () => {
  const awaiting = withAwaitingTransferMetadata({ collected: { transfer_label: "Rhys" } });
  assert.equal(awaiting.awaiting_post_transfer_recording, true);
  assert.equal(awaiting.transfer_recording_provider, "mor_sip");
  const attached = withAttachedRecordingMetadata(awaiting, { mor_recording_id: "2" });
  assert.equal(attached.awaiting_post_transfer_recording, undefined);
  assert.equal(attached.post_transfer_recording_attached, true);
  assert.equal(attached.mor_recording_id, "2");
});
