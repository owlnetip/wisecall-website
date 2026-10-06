// Website chat name, opening line, and photo. Stored on the agent and read by
// wisecall-live-chat. Empty name or greeting means "use the agent's own name /
// the default hello". A photo is a circular face on the website chat only.

const NAME_MAX = 40;
const GREETING_MAX = 240;

export const CHAT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const CHAT_AVATAR_BUCKET = "chat-avatars";

// BetterMove's website chat already uses this face. The saved logo on the
// profile is still their wordmark, so the portal treats that as "no custom photo".
export const BETTERMOVE_CHAT_SLUG = "bettermove-assistant-bettermove-4a19c75d";
export const BETTERMOVE_CHAT_WORDMARK =
  "https://www.bettermove.co.uk/wp-content/themes/cb-bettermove2023/img/bm-logo-2026.svg";
export const BETTERMOVE_CHAT_AVATAR = "https://wisecall.io/bettermove-chat-avatar.webp";

export function cleanChatAssistantName(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return { ok: true, value: "" };
  if (name.length > NAME_MAX) return { ok: false, error: "Chat name must be 40 characters or fewer." };
  if (!/^[\p{L}][\p{L}\s'’.-]*$/u.test(name)) {
    return { ok: false, error: "Use letters for the chat name." };
  }
  return { ok: true, value: name };
}

export function cleanChatGreeting(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const greeting = value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!greeting) return { ok: true, value: "" };
  if (greeting.length > GREETING_MAX) {
    return { ok: false, error: "Opening line must be 240 characters or fewer." };
  }
  if (/[<>]/.test(greeting)) return { ok: false, error: "Opening line can't include < or >." };
  return { ok: true, value: greeting };
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

// Sniff the file. The browser-supplied type is not trusted.
export function inspectChatPhoto(
  bytes: Uint8Array,
): { ok: true; contentType: string; ext: string } | { ok: false; error: string } {
  if (!bytes.byteLength) return { ok: false, error: "Choose a photo to upload." };
  if (bytes.byteLength > CHAT_AVATAR_MAX_BYTES) return { ok: false, error: "Photo must be under 2 MB." };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, contentType: "image/png", ext: "png" };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { ok: true, contentType: "image/jpeg", ext: "jpg" };
  }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ok: true, contentType: "image/webp", ext: "webp" };
  }
  return { ok: false, error: "Use a PNG, JPG or WEBP photo." };
}

export function isChatPhotoUrl(url: string): boolean {
  const raw = url.trim();
  if (!/^https:\/\//i.test(raw)) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    return /\.(png|jpe?g|webp|gif)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

// A photo this customer uploaded. The BetterMove preset face is not one of these.
export function savedChatPhotoUrl(slug: string | undefined, savedUrl: string | undefined): string {
  const url = (savedUrl || "").trim();
  if (!isChatPhotoUrl(url)) return "";
  if (slug === BETTERMOVE_CHAT_SLUG && url === BETTERMOVE_CHAT_AVATAR) return "";
  return url;
}

// What the portal preview shows: their upload, or the BetterMove face when they
// have not replaced it.
export function previewChatPhotoUrl(slug: string | undefined, savedUrl: string | undefined): string {
  const custom = savedChatPhotoUrl(slug, savedUrl);
  if (custom) return custom;
  const url = (savedUrl || "").trim();
  if (slug === BETTERMOVE_CHAT_SLUG && (!url || url === BETTERMOVE_CHAT_WORDMARK || url === BETTERMOVE_CHAT_AVATAR)) {
    return BETTERMOVE_CHAT_AVATAR;
  }
  return "";
}

export type ChatLogoMode = "" | "avatar" | "icon";

// Same rules as public/widget.js. A raster photo with no mode is a circular
// face. An explicit icon mode stays an icon. SVG wordmarks stay wide.
export function resolveChatLogo(input: {
  remoteUrl?: string;
  remoteMode?: string;
  presetUrl?: string;
  presetMode?: string;
  wordmarkUrl?: string;
}): { url: string; mode: ChatLogoMode } {
  const remoteUrl = (input.remoteUrl || "").trim();
  const remoteMode = (input.remoteMode || "").trim();
  const presetUrl = (input.presetUrl || "").trim();
  const presetMode = (input.presetMode || "").trim();
  const wordmarkUrl = (input.wordmarkUrl || "").trim();

  let url = remoteUrl || presetUrl;
  let mode: ChatLogoMode = remoteMode === "avatar" || remoteMode === "icon"
    ? remoteMode
    : presetMode === "avatar" || presetMode === "icon"
      ? presetMode
      : "";

  if (presetMode === "avatar" && presetUrl) {
    if (!remoteUrl || remoteUrl === wordmarkUrl) {
      url = presetUrl;
      mode = "avatar";
    } else if (!remoteMode && isChatPhotoUrl(remoteUrl)) {
      mode = "avatar";
    } else if (!remoteMode) {
      mode = "";
    }
  }

  if (!mode && isChatPhotoUrl(url)) mode = "avatar";
  if (mode !== "avatar" && mode !== "icon") mode = "";
  return { url, mode };
}

// Object path inside chat-avatars, only when the URL is one this profile uploaded.
export function chatAvatarObjectPath(publicUrl: string, profileId: string): string | null {
  const id = profileId.trim();
  if (!id || id.includes("/") || id.includes("..") || publicUrl.includes("..")) return null;
  try {
    const parsed = new URL(publicUrl);
    const marker = `/storage/v1/object/public/${CHAT_AVATAR_BUCKET}/`;
    const index = parsed.pathname.indexOf(marker);
    if (index === -1) return null;
    const path = decodeURIComponent(parsed.pathname.slice(index + marker.length));
    if (!path.startsWith(`${id}/`) || path.includes("..") || path.includes("//")) return null;
    return path;
  } catch {
    return null;
  }
}
