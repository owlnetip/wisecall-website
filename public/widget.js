/* WiseCall website chat widget — embed on any site:
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
    root.innerHTML =
      "<style>" +
      ":host{all:initial}" +
      "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
      ".launcher{position:fixed;bottom:20px;" +
      SIDE +
      ":20px;width:60px;height:60px;border-radius:50%;background:" +
      accent +
      ";color:" +
      onAccent +
      ";border:none;cursor:pointer;box-shadow:0 8px 28px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;transition:transform .15s}" +
      ".launcher:hover{transform:scale(1.06)}" +
      ".launcher svg{width:28px;height:28px}" +
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
      ":0;width:100vw;max-width:100vw;height:100vh;max-height:100vh;border-radius:0}}" +
      "</style>" +
      '<button class="launcher" aria-label="Open chat">' +
      '<svg viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</button>" +
      '<div class="panel hidden" role="dialog" aria-label="Chat">' +
      '<div class="hdr"><div class="av">' +
      (cfg.assistant_name || "A").charAt(0).toUpperCase() +
      '</div><div><div class="t">' +
      esc(cfg.title) +
      '</div><div class="s">' +
      esc(cfg.assistant_name) +
      '</div></div><button class="x" aria-label="Close">&times;</button></div>' +
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

  function bubble(role, content) {
    var b = root.querySelector(".body");
    var d = document.createElement("div");
    d.className = "msg " + (role === "user" ? "me" : "bot");
    d.textContent = content;
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
        var reply = (data && data.reply) || "Sorry, I didn't catch that — could you try again?";
        bubble("assistant", reply);
        messages.push({ role: "assistant", content: reply });
      })
      .catch(function () {
        typing(false);
        bubble("assistant", "Sorry, I'm having trouble connecting. Please try again in a moment.");
      });
  }

  // Fetch theming/greeting, then render.
  fetch(BASE + "?profile_slug=" + encodeURIComponent(SLUG))
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (data && !data.error) {
        cfg.title = data.title || cfg.title;
        cfg.assistant_name = data.assistant_name || cfg.assistant_name;
        cfg.greeting = data.greeting || cfg.greeting;
        cfg.accent_color = data.accent_color || cfg.accent_color;
        cfg.background_color = data.background_color || cfg.background_color;
      }
    })
    .catch(function () {})
    .then(render);
})();
