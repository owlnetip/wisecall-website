/* WiseCall website chat widget, embed on any site:
 *   <script src="https://wisecall.io/widget.js" data-agent="your-agent-slug" async></script>
 * Optional attributes: data-position="left", data-base="<custom fn url>".
 * Self-contained, no dependencies, isolated in a Shadow DOM so it can't clash
 * with the host page's CSS. Talks to the public wisecall-live-chat function.
 */
(function () {
  "use strict";
  var script =
    document.currentScript ||
    (function () {
      var s = document.getElementsByTagName("script");
      for (var i = s.length - 1; i >= 0; i--) if (s[i].getAttribute("data-agent")) return s[i];
      return null;
    })();
  if (!script) return;

  var SLUG = script.getAttribute("data-agent");
  if (!SLUG) {
    console.error("[WiseCall] widget needs a data-agent slug.");
    return;
  }
  var BASE =
    script.getAttribute("data-base") ||
    "https://zgzzpwaqqftmugzpccpm.supabase.co/functions/v1/wisecall-live-chat";
  var SIDE = script.getAttribute("data-position") === "left" ? "left" : "right";

  if (window.__wisecallWidgetLoaded) return;
  window.__wisecallWidgetLoaded = true;

  var cfg = {
    title: "Chat",
    assistant_name: "Assistant",
    greeting: "Hi! How can I help today?",
    accent_color: "#7de8eb",
    background_color: "#172929",
    logo_url: "",
    font_family: "",
    font_stylesheet: "",
    launcher_label: "",
  };

  // Per-agent brand presets. The live-chat config overrides these when it
  // returns logo_url / font_family, so a metadata change does not need a
  // widget release. BetterMove's wordmark is Lexend (their heading face).
  var BRAND = {
    "bettermove-assistant-bettermove-4a19c75d": {
      logo_url:
        "https://www.bettermove.co.uk/wp-content/themes/cb-bettermove2023/img/bm-logo-2026.svg",
      font_family: "Lexend, system-ui, sans-serif",
      font_stylesheet:
        "https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&display=swap",
      launcher_label: "Chat with us",
    },
  };
  var sessionId = null;
  var messages = []; // {role:'user'|'assistant', content}
  var opened = false;
  var greeted = false;

  // ── Shadow root host ───────────────────────────────────────────────────────
  var host = document.createElement("div");
  host.style.cssText =
    "position:fixed;bottom:0;" + SIDE + ":0;z-index:2147483000;width:0;height:0;";
  document.body.appendChild(host);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  function safeHttps(url) {
    var raw = String(url || "").trim();
    if (!/^https:\/\//i.test(raw)) return "";
    try {
      var u = new URL(raw);
      if (u.protocol !== "https:") return "";
      return u.href.replace(/["']/g, "");
    } catch (e) {
      return "";
    }
  }

  function safeFontFamily(value) {
    var s = String(value || "").trim();
    if (!s || s.length > 160) return "";
    if (!/^[\w\s,'"().-]+$/.test(s)) return "";
    return s;
  }

  function safeLabel(value) {
    var s = String(value || "").replace(/\s+/g, " ").trim();
    if (!s || s.length > 40) return "";
    if (!/^[\w\s'’!?.-]+$/.test(s)) return "";
    return s;
  }

  function textColorFor(bg) {
    // Pick readable text colour for the accent button.
    try {
      var c = bg.replace("#", "");
      var r = parseInt(c.substr(0, 2), 16),
        g = parseInt(c.substr(2, 2), 16),
        b = parseInt(c.substr(4, 2), 16);
      return r * 0.299 + g * 0.587 + b * 0.114 > 160 ? "#0e1b1b" : "#0e1b1b";
    } catch (e) {
      return "#0e1b1b";
    }
  }

  function render() {
    var accent = cfg.accent_color || "#7de8eb";
    var bg = cfg.background_color || "#172929";
    var onAccent = textColorFor(accent);
    var logo = safeHttps(cfg.logo_url);
    var font =
      safeFontFamily(cfg.font_family) ||
      "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
    var fontCss = safeHttps(cfg.font_stylesheet);
    var label = safeLabel(cfg.launcher_label);
    var chatIcon =
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var launcherInner = logo
      ? '<img src="' +
        esc(logo) +
        '" alt=""/>' +
        (label ? '<span class="launch-label">' + chatIcon + esc(label) + "</span>" : "")
      : chatIcon;
    var avatar = logo
      ? '<div class="av logo"><img src="' + esc(logo) + '" alt=""/></div>'
      : '<div class="av">' + (cfg.assistant_name || "A").charAt(0).toUpperCase() + "</div>";
    root.innerHTML =
      "<style>" +
      (fontCss ? "@import url('" + fontCss + "');" : "") +
      ":host{all:initial}" +
      "*{box-sizing:border-box;font-family:" +
      font +
      "}" +
      ".launcher{position:fixed;bottom:20px;" +
      SIDE +
      ":20px;width:60px;height:60px;border-radius:50%;background:" +
      accent +
      ";color:" +
      onAccent +
      ";border:none;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;transition:transform .15s}" +
      ".launcher:hover{transform:scale(1.06)}" +
      ".launcher svg{width:28px;height:28px}" +
      ".launcher.has-logo{width:auto;height:64px;padding:0 16px;border-radius:999px;background:#fff;border:1px solid rgba(18,58,75,.12)}" +
      ".launcher.has-logo img{height:32px;width:auto;max-width:168px;display:block}" +
      ".launcher.has-logo.has-label{gap:10px;height:56px;padding:0 16px 0 12px}" +
      ".launcher.has-logo.has-label img{height:20px;max-width:112px}" +
      ".launch-label{display:flex;align-items:center;gap:7px;padding-left:10px;border-left:1px solid rgba(18,58,75,.16);color:#123A4B;font-weight:700;font-size:14.5px;line-height:1;white-space:nowrap}" +
      ".launcher .launch-label svg{width:18px;height:18px;color:#E07A6E}" +
      ".hdr .av.logo{width:auto;height:auto;border-radius:10px;background:#fff;padding:5px 10px}" +
      ".hdr .av.logo img{height:28px;width:auto;max-width:180px;display:block}" +
      ".panel{position:fixed;bottom:92px;" +
      SIDE +
      ":20px;width:374px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.32);display:flex;flex-direction:column;overflow:hidden}" +
      ".hdr{background:" +
      bg +
      ";color:#fff;padding:16px 18px;display:flex;align-items:center;gap:10px}" +
      ".hdr .av{width:36px;height:36px;border-radius:50%;background:" +
      accent +
      ";color:" +
      onAccent +
      ";display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0}" +
      ".hdr .t{font-weight:800;font-size:15px;line-height:1.2}" +
      ".hdr .s{font-size:12px;opacity:.7}" +
      ".hdr .x{margin-" +
      (SIDE === "right" ? "left" : "right") +
      ":auto;background:transparent;border:none;color:#fff;opacity:.7;cursor:pointer;font-size:22px;line-height:1}" +
      ".body{flex:1;overflow-y:auto;padding:16px;background:#f6f8f8;display:flex;flex-direction:column;gap:10px}" +
      ".msg{max-width:84%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}" +
      ".msg a{color:inherit;text-decoration:underline;word-break:break-all}" +
      ".msg.bot{align-self:flex-start;background:#fff;color:#111716;border:1px solid rgba(0,0,0,.06);border-bottom-left-radius:4px}" +
      ".msg.me{align-self:flex-end;background:" +
      accent +
      ";color:" +
      onAccent +
      ";border-bottom-right-radius:4px}" +
      ".typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px}" +
      ".typing i{width:7px;height:7px;border-radius:50%;background:#b6c2c1;animation:b 1s infinite}" +
      ".typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}" +
      "@keyframes b{0%,60%,100%{opacity:.3}30%{opacity:1}}" +
      ".foot{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(0,0,0,.06);background:#fff}" +
      ".foot input{flex:1;border:1px solid rgba(0,0,0,.12);border-radius:10px;padding:10px 12px;font-size:14px;outline:none}" +
      ".foot input:focus{border-color:" +
      accent +
      "}" +
      ".foot button{background:" +
      bg +
      ";color:#fff;border:none;border-radius:10px;padding:0 16px;font-weight:800;cursor:pointer}" +
      ".pb{padding:8px;text-align:center;font-size:11px;color:#9aa5a2;background:#fff}" +
      ".pb a{color:#9aa5a2;text-decoration:none}" +
      ".hidden{display:none!important}" +
      "@media(max-width:480px){.panel{bottom:0;" +
      SIDE +
      ":0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}" +
      ".launcher.has-logo.has-label{height:52px;padding:0 12px 0 10px}" +
      ".launcher.has-logo.has-label img{height:16px;max-width:84px}" +
      ".launch-label{font-size:13px;gap:6px;padding-left:8px}" +
      ".launcher .launch-label svg{width:16px;height:16px}}" +
      "</style>" +
      '<button class="launcher' +
      (logo ? " has-logo" : "") +
      (label ? " has-label" : "") +
      '" aria-label="' +
      esc(label || "Open chat") +
      '">' +
      launcherInner +
      "</button>" +
      '<div class="panel hidden" role="dialog" aria-label="' +
      esc(cfg.title || "Chat") +
      '">' +
      '<div class="hdr">' +
      avatar +
      (logo
        ? ""
        : '<div><div class="t">' +
          esc(cfg.title) +
          '</div><div class="s">' +
          esc(cfg.assistant_name) +
          "</div></div>") +
      '<button class="x" aria-label="Close">&times;</button></div>' +
      '<div class="body"></div>' +
      '<div class="foot"><input type="text" placeholder="Type your message…" aria-label="Message"/><button class="send">Send</button></div>' +
      '<div class="pb">Powered by <a href="https://wisecall.io" target="_blank" rel="noopener">WiseCall</a></div>' +
      "</div>";

    root.querySelector(".launcher").onclick = toggle;
    root.querySelector(".x").onclick = toggle;
    var input = root.querySelector(".foot input");
    root.querySelector(".send").onclick = send;
    input.onkeydown = function (e) {
      if (e.key === "Enter") send();
    };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // Render message text with bare http(s) URLs as safe, clickable anchors.
  // Built with DOM nodes (never innerHTML) so message content stays inert.
  function renderContent(el, text) {
    var s = String(text == null ? "" : text);
    var re = /https?:\/\/[^\s<>"']+/g;
    var last = 0;
    var m;
    while ((m = re.exec(s))) {
      var url = m[0].replace(/[.,;:!?)\]]+$/, "");
      if (m.index > last) el.appendChild(document.createTextNode(s.slice(last, m.index)));
      var a = document.createElement("a");
      a.href = url;
      a.textContent = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      el.appendChild(a);
      last = m.index + url.length;
      re.lastIndex = last;
    }
    if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
  }

  function bubble(role, content) {
    var b = root.querySelector(".body");
    var d = document.createElement("div");
    d.className = "msg " + (role === "user" ? "me" : "bot");
    renderContent(d, content);
    b.appendChild(d);
    b.scrollTop = b.scrollHeight;
  }
  function typing(on) {
    var b = root.querySelector(".body");
    var ex = b.querySelector(".typing");
    if (on && !ex) {
      var t = document.createElement("div");
      t.className = "typing";
      t.innerHTML = "<i></i><i></i><i></i>";
      b.appendChild(t);
      b.scrollTop = b.scrollHeight;
    } else if (!on && ex) ex.remove();
  }

  function toggle() {
    var panel = root.querySelector(".panel");
    opened = !opened;
    panel.classList.toggle("hidden", !opened);
    root.querySelector(".launcher").classList.toggle("hidden", opened);
    if (opened) {
      if (!greeted) {
        greeted = true;
        bubble("assistant", cfg.greeting);
      }
      root.querySelector(".foot input").focus();
    }
  }

  function send() {
    var input = root.querySelector(".foot input");
    var text = (input.value || "").trim();
    if (!text) return;
    input.value = "";
    bubble("user", text);
    messages.push({ role: "user", content: text });
    typing(true);
    fetch(BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_slug: SLUG,
        message: text,
        messages: messages,
        session_id: sessionId,
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        typing(false);
        if (data && data.session_id) sessionId = data.session_id;
        var reply = (data && data.reply) || "Sorry, I didn't catch that, could you try again?";
        bubble("assistant", reply);
        messages.push({ role: "assistant", content: reply });
      })
      .catch(function () {
        typing(false);
        bubble("assistant", "Sorry, I'm having trouble connecting. Please try again in a moment.");
      });
  }

  function applyBranding(data) {
    var preset = BRAND[SLUG] || {};
    var remote = data && !data.error ? data : {};
    if (remote.title) cfg.title = remote.title;
    if (remote.assistant_name) cfg.assistant_name = remote.assistant_name;
    if (remote.greeting) cfg.greeting = remote.greeting;
    if (remote.accent_color) cfg.accent_color = remote.accent_color;
    if (remote.background_color) cfg.background_color = remote.background_color;
    cfg.logo_url = remote.logo_url || preset.logo_url || "";
    cfg.font_family = remote.font_family || preset.font_family || "";
    cfg.font_stylesheet = remote.font_stylesheet || preset.font_stylesheet || "";
    cfg.launcher_label = remote.launcher_label || preset.launcher_label || "";
    // Optional embed overrides, used by the local preview.
    if (script.getAttribute("data-logo")) cfg.logo_url = script.getAttribute("data-logo");
    if (script.getAttribute("data-font")) cfg.font_family = script.getAttribute("data-font");
    if (script.getAttribute("data-font-css")) cfg.font_stylesheet = script.getAttribute("data-font-css");
    if (script.getAttribute("data-launcher-label")) cfg.launcher_label = script.getAttribute("data-launcher-label");
  }

  // Fetch theming/greeting, then render.
  fetch(BASE + "?profile_slug=" + encodeURIComponent(SLUG))
    .then(function (r) {
      return r.json();
    })
    .then(applyBranding)
    .catch(function () {
      applyBranding(null);
    })
    .then(render);
})();
