import assert from "node:assert/strict";
import test from "node:test";
import {
  BETTERMOVE_CHAT_AVATAR,
  BETTERMOVE_CHAT_SLUG,
  BETTERMOVE_CHAT_WORDMARK,
  chatAvatarObjectPath,
  cleanChatAssistantName,
  cleanChatGreeting,
  inspectChatPhoto,
  previewChatPhotoUrl,
  resolveChatLogo,
  savedChatPhotoUrl,
} from "./chat-widget-settings";

test("chat name keeps a normal first name", () => {
  assert.deepEqual(cleanChatAssistantName("  Betty "), { ok: true, value: "Betty" });
});

test("chat name rejects markup and numbers", () => {
  assert.equal(cleanChatAssistantName("Betty<script>").ok, false);
  assert.equal(cleanChatAssistantName("Betty 2").ok, false);
});

test("empty chat name is allowed so the agent name is used", () => {
  assert.deepEqual(cleanChatAssistantName("   "), { ok: true, value: "" });
});

test("opening line keeps the BetterMove sentence", () => {
  const line = "Hi, I'm Betty, Bettermove's AI Assistant. How can I help today?";
  assert.deepEqual(cleanChatGreeting(line), { ok: true, value: line });
});

test("opening line rejects tags and very long text", () => {
  assert.equal(cleanChatGreeting("Hello <b>there</b>").ok, false);
  assert.equal(cleanChatGreeting("Hi ".repeat(200)).ok, false);
});

const PROFILE = "11111111-1111-1111-1111-111111111111";
const PHOTO = "https://zgzzpwaqqftmugzpccpm.supabase.co/storage/v1/object/public/chat-avatars/" + PROFILE + "/face.png";

test("chat photo accepts png, jpeg and webp bytes only", () => {
  assert.deepEqual(inspectChatPhoto(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), {
    ok: true,
    contentType: "image/png",
    ext: "png",
  });
  assert.equal(inspectChatPhoto(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])).ok, true);
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46], 0);
  webp.set([0x57, 0x45, 0x42, 0x50], 8);
  assert.equal(inspectChatPhoto(webp).ok, true);
  assert.equal(inspectChatPhoto(Uint8Array.from([0x47, 0x49, 0x46, 0x38])).ok, false);
  assert.equal(inspectChatPhoto(new TextEncoder().encode("<svg></svg>")).ok, false);
  assert.equal(inspectChatPhoto(new Uint8Array(2 * 1024 * 1024 + 1)).ok, false);
});

test("BetterMove keeps its face until a customer uploads a different photo", () => {
  assert.equal(previewChatPhotoUrl(BETTERMOVE_CHAT_SLUG, BETTERMOVE_CHAT_WORDMARK), BETTERMOVE_CHAT_AVATAR);
  assert.equal(previewChatPhotoUrl(BETTERMOVE_CHAT_SLUG, ""), BETTERMOVE_CHAT_AVATAR);
  assert.equal(savedChatPhotoUrl(BETTERMOVE_CHAT_SLUG, BETTERMOVE_CHAT_WORDMARK), "");
  assert.equal(savedChatPhotoUrl(BETTERMOVE_CHAT_SLUG, PHOTO), PHOTO);
  assert.equal(previewChatPhotoUrl("other-agent", ""), "");
  assert.equal(previewChatPhotoUrl("other-agent", PHOTO), PHOTO);
});

test("a saved photo is a circular face and an icon logo stays an icon", () => {
  const face = resolveChatLogo({
    remoteUrl: BETTERMOVE_CHAT_WORDMARK,
    presetUrl: BETTERMOVE_CHAT_AVATAR,
    presetMode: "avatar",
    wordmarkUrl: BETTERMOVE_CHAT_WORDMARK,
  });
  assert.deepEqual(face, { url: BETTERMOVE_CHAT_AVATAR, mode: "avatar" });

  const uploaded = resolveChatLogo({
    remoteUrl: PHOTO,
    presetUrl: BETTERMOVE_CHAT_AVATAR,
    presetMode: "avatar",
    wordmarkUrl: BETTERMOVE_CHAT_WORDMARK,
  });
  assert.deepEqual(uploaded, { url: PHOTO, mode: "avatar" });

  const wordmark = resolveChatLogo({
    remoteUrl: "https://example.com/logo.svg",
    presetUrl: BETTERMOVE_CHAT_AVATAR,
    presetMode: "avatar",
    wordmarkUrl: BETTERMOVE_CHAT_WORDMARK,
  });
  assert.deepEqual(wordmark, { url: "https://example.com/logo.svg", mode: "" });

  const icon = resolveChatLogo({
    remoteUrl: PHOTO,
    presetMode: "icon",
  });
  assert.deepEqual(icon, { url: PHOTO, mode: "icon" });

  const plain = resolveChatLogo({ remoteUrl: PHOTO });
  assert.deepEqual(plain, { url: PHOTO, mode: "avatar" });
});

test("only this profile's uploaded photo can be removed from storage", () => {
  assert.equal(chatAvatarObjectPath(PHOTO, PROFILE), PROFILE + "/face.png");
  assert.equal(chatAvatarObjectPath(PHOTO, "someone-else"), null);
  assert.equal(chatAvatarObjectPath(BETTERMOVE_CHAT_AVATAR, PROFILE), null);
  assert.equal(chatAvatarObjectPath(PHOTO + "/../../secret", PROFILE), null);
});
