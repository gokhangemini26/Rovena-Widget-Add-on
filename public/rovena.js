/* ══════════════════════════════════════════════════════════════════════════
   Rovena loader — the one line a brand pastes into its site.

     <script src="https://widget.rovena.ai/rovena.js"
             data-tenant="giovane-gentile" defer></script>

   Everything else the widget does happens inside an iframe. That boundary is
   the product decision this file exists to enforce:

   · The brand's page cannot read the conversation, and we cannot read the
     brand's DOM, cookies or checkout. Neither side has to trust the other's
     JavaScript, which is what makes this installable by an IT department in an
     afternoon rather than after a security review.
   · Our CSS cannot leak into their site and their CSS cannot break our widget
     — the single most common way an embedded widget looks broken in production.

   Deliberately dependency-free and un-built: a brand's CSP, an old bundler and
   a strict reviewer all cope with one plain file. Keep it that way.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  if (window.__rovenaLoaded) return;
  window.__rovenaLoaded = true;

  var script = document.currentScript;
  if (!script) {
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf("rovena.js") !== -1) { script = all[i]; break; }
    }
  }
  if (!script) return;

  var tenant = script.getAttribute("data-tenant");
  if (!tenant) {
    console.error("[Rovena] data-tenant eksik. Örnek: <script src=... data-tenant=\"marka-adi\">");
    return;
  }

  // The widget origin is derived from where this file was served from, so a
  // brand never has to configure two URLs and can never point them at
  // different environments by accident.
  var origin = script.getAttribute("data-origin") || new URL(script.src).origin;
  var mode = script.getAttribute("data-mode") || "launcher"; // launcher | inline
  var mountSelector = script.getAttribute("data-mount");
  var autoOpen = script.getAttribute("data-open") === "true";

  var state = {
    open: false,
    ready: false,
    config: null,
    iframe: null,
    launcher: null,
    panel: null,
    pending: [],
    context: { sku: null, cart: [] },
  };

  /* ── styling ─────────────────────────────────────────────────────────────
     Every rule is scoped to .rovena-* and every value comes from the tenant
     config, so two brands never share a look and neither inherits ours. */

  function injectStyles(theme) {
    if (document.getElementById("rovena-styles")) return;
    var side = theme.position === "bottom-left" ? "left" : "right";
    var css = [
      ".rovena-launcher{position:fixed;bottom:24px;" + side + ":24px;z-index:2147483000;",
      "display:flex;align-items:center;gap:10px;border:0;cursor:pointer;",
      "padding:14px 20px;border-radius:" + theme.radius + "px;",
      "background:" + theme.accent + ";color:" + theme.accentInk + ";",
      "font-family:" + theme.fontBody + ";font-size:15px;line-height:1;letter-spacing:.01em;",
      "box-shadow:0 8px 30px rgba(0,0,0,.18);transition:transform .18s ease,opacity .18s ease}",
      ".rovena-launcher:hover{transform:translateY(-2px)}",
      ".rovena-launcher[hidden]{display:none}",
      ".rovena-panel{position:fixed;bottom:24px;" + side + ":24px;z-index:2147483001;",
      "width:400px;height:640px;max-height:calc(100vh - 48px);max-width:calc(100vw - 32px);",
      "border-radius:" + theme.radius + "px;overflow:hidden;background:" + theme.surface + ";",
      "box-shadow:0 24px 60px rgba(0,0,0,.28);opacity:0;transform:translateY(12px) scale(.98);",
      "transition:opacity .2s ease,transform .2s ease;pointer-events:none}",
      ".rovena-panel.rovena-visible{opacity:1;transform:none;pointer-events:auto}",
      ".rovena-panel iframe,.rovena-inline iframe{width:100%;height:100%;border:0;display:block}",
      ".rovena-inline{width:100%;height:640px;border-radius:" + theme.radius + "px;overflow:hidden}",
      // Below 640px a floating panel is a worse experience than a full screen,
      // and fashion traffic is overwhelmingly mobile.
      "@media (max-width:640px){.rovena-panel{inset:0;width:100%;height:100%;",
      "max-width:100%;max-height:100%;border-radius:0}",
      ".rovena-launcher{bottom:16px;" + side + ":16px;padding:12px 18px}}",
      "@media (prefers-reduced-motion:reduce){.rovena-launcher,.rovena-panel{transition:none}}",
    ].join("");
    var el = document.createElement("style");
    el.id = "rovena-styles";
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ── frame ───────────────────────────────────────────────────────────── */

  function buildIframe() {
    var iframe = document.createElement("iframe");
    iframe.src = origin + "/embed/" + encodeURIComponent(tenant) +
      "?host=" + encodeURIComponent(location.origin);
    iframe.title = (state.config && state.config.persona.displayName) || "Rovena";
    iframe.setAttribute("allow", "microphone");
    // No allow-top-navigation and no allow-popups-to-escape-sandbox: the widget
    // must never be able to move the brand's customer off the brand's page.
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
    iframe.setAttribute("loading", "lazy");
    return iframe;
  }

  function mountLauncher() {
    var theme = state.config.theme;
    var launcher = document.createElement("button");
    launcher.className = "rovena-launcher";
    launcher.type = "button";
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-expanded", "false");
    if (theme.logoUrl) {
      var img = document.createElement("img");
      img.src = theme.logoUrl;
      img.alt = "";
      img.width = 20; img.height = 20;
      img.style.cssText = "width:20px;height:20px;object-fit:contain";
      launcher.appendChild(img);
    }
    launcher.appendChild(document.createTextNode(state.config.persona.displayName));
    launcher.addEventListener("click", function () { toggle(); });

    var panel = document.createElement("div");
    panel.className = "rovena-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label", state.config.persona.displayName);
    panel.appendChild(state.iframe);

    document.body.appendChild(launcher);
    document.body.appendChild(panel);
    state.launcher = launcher;
    state.panel = panel;

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.open) toggle(false);
    });
  }

  function mountInline() {
    var host = mountSelector ? document.querySelector(mountSelector) : null;
    if (!host) {
      console.error("[Rovena] data-mode=\"inline\" için data-mount seçicisi bulunamadı:", mountSelector);
      return;
    }
    var wrap = document.createElement("div");
    wrap.className = "rovena-inline";
    wrap.appendChild(state.iframe);
    host.appendChild(wrap);
    state.open = true;
  }

  function toggle(force) {
    var next = typeof force === "boolean" ? force : !state.open;
    if (next === state.open) return;
    state.open = next;
    if (state.panel) state.panel.classList.toggle("rovena-visible", next);
    if (state.launcher) {
      state.launcher.setAttribute("aria-expanded", String(next));
      state.launcher.hidden = next && window.innerWidth <= 640;
    }
    post({ type: next ? "open" : "close" });
    track(next ? "widget_open" : "widget_close");
  }

  /* ── messaging ───────────────────────────────────────────────────────── */

  function post(message) {
    if (!state.iframe || !state.iframe.contentWindow) return;
    if (!state.ready && message.type !== "init") { state.pending.push(message); return; }
    message.source = "rovena-host";
    // Targeted at the widget origin, never "*": a wildcard would broadcast the
    // customer's cart contents to whatever else can see the frame.
    state.iframe.contentWindow.postMessage(message, origin);
  }

  function flushPending() {
    var queued = state.pending.splice(0, state.pending.length);
    for (var i = 0; i < queued.length; i++) post(queued[i]);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== origin) return;
    var data = event.data;
    if (!data || data.source !== "rovena") return;

    if (data.type === "ready") {
      state.ready = true;
      post({ type: "context", payload: state.context });
      flushPending();
      return;
    }
    if (data.type === "close") { toggle(false); return; }
    if (data.type === "add-to-cart") { handleAddToCart(data.payload || {}); return; }
    if (data.type === "navigate") { handleNavigate(data.payload || {}); return; }
    if (data.type === "event") { track(data.payload && data.payload.event, data.payload); return; }
  });

  /* ── cart bridge ─────────────────────────────────────────────────────────
     Three modes, cheapest first. The failure path matters more than the happy
     one: if the brand's own function throws, the customer must still end up on
     a page where they can buy the item, and we must be able to see that it
     happened — a silently swallowed add-to-cart looks like "the AI doesn't
     work" in a QBR. */

  function handleAddToCart(payload) {
    var cart = state.config.cart || { mode: "redirect" };
    var done = function (ok, detail) {
      post({ type: "cart-result", payload: { ok: ok, sku: payload.sku, detail: detail } });
      track(ok ? "add_to_cart" : "cart_bridge_failed", payload);
    };

    // Dispatch host custom event so the host page can react immediately
    try {
      window.dispatchEvent(new CustomEvent("rovena:add-to-cart", { detail: payload }));
    } catch (e) {}

    // Check direct callback or global handler
    var hostFn = (cart.mode === "callback" && cart.callbackName) ? resolveGlobal(cart.callbackName) : window.rovenaAddToCart;
    if (typeof hostFn === "function") {
      try {
        var result = hostFn({ sku: payload.sku, size: payload.size, quantity: payload.quantity || 1, url: payload.url });
        Promise.resolve(result).then(
          function () { done(true); },
          function (err) {
            console.error("[Rovena] Sepete ekleme başarısız:", err);
            done(false, "callback_rejected");
          }
        );
      } catch (err) {
        console.error("[Rovena] Sepete ekleme hatası:", err);
        done(false, "callback_threw");
      }
      return;
    }

    if (cart.mode === "api" && payload.url) {
      done(true, "api");
      return;
    }

    openProduct(payload.url);
    done(true, "redirect");
  }

  function handleNavigate(payload) {
    try {
      window.dispatchEvent(new CustomEvent("rovena:navigate", { detail: payload }));
    } catch (e) {}
    openProduct(payload.url);
    track("product_clicked", payload);
  }

  function openProduct(url) {
    if (!url) return;
    // Same-origin product links replace the page (the customer expects to land
    // on the PDP); anything else opens in a new tab so the conversation is not
    // destroyed by an outbound link.
    try {
      var target = new URL(url, location.href);
      if (target.origin === location.origin) { location.href = target.href; return; }
      window.open(target.href, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[Rovena] Geçersiz ürün adresi:", url);
    }
  }

  function resolveGlobal(path) {
    var parts = String(path).split(".");
    var cur = window;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return null;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /* ── analytics ───────────────────────────────────────────────────────── */

  function track(event, payload) {
    if (!event) return;
    var body = JSON.stringify({
      tenant: tenant,
      event: event,
      sku: (payload && payload.sku) || null,
      size: (payload && payload.size) || null,
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(origin + "/api/events", new Blob([body], { type: "application/json" }));
      } else {
        fetch(origin + "/api/events", {
          method: "POST", body: body, keepalive: true,
          headers: { "content-type": "application/json" },
        }).catch(function () {});
      }
    } catch (e) { /* analytics must never surface to the customer */ }

    // Mirror into the brand's own analytics when they have one, so Rovena's
    // contribution shows up in the reports they already read.
    if (typeof window.dataLayer !== "undefined" && window.dataLayer.push) {
      window.dataLayer.push({ event: "rovena_" + event, rovena: payload || {} });
    }
  }

  /* ── public API ──────────────────────────────────────────────────────────
     Lets a brand deepen the integration without another script: a PDP can tell
     the widget which product is on screen, and a "style this" button can open
     the conversation already pointed at it. */

  window.Rovena = {
    open: function () { toggle(true); },
    close: function () { toggle(false); },
    toggle: function () { toggle(); },
    /** Tell the widget which product the customer is looking at. */
    setProduct: function (sku) {
      state.context.sku = sku || null;
      post({ type: "context", payload: state.context });
    },
    /** Keep the widget aware of the host cart so it stops re-suggesting items. */
    setCart: function (skus) {
      state.context.cart = Array.isArray(skus) ? skus.slice(0, 20) : [];
      post({ type: "context", payload: state.context });
    },
    /** Open with an opening question already asked. */
    ask: function (text) {
      toggle(true);
      post({ type: "ask", payload: { text: String(text || "").slice(0, 500) } });
    },
    openWithProduct: function (sku) {
      toggle(true);
      this.setProduct(sku);
      this.ask("Bu parçayı (" + sku + ") neyle kombinlerim?");
    },
    isReady: function () { return state.ready; },
  };

  /* ── boot ────────────────────────────────────────────────────────────── */

  fetch(origin + "/api/config/" + encodeURIComponent(tenant), { credentials: "omit" })
    .then(function (r) {
      if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || r.status); });
      return r.json();
    })
    .then(function (config) {
      state.config = config;
      injectStyles(config.theme);
      if (config.theme.fontUrl) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = config.theme.fontUrl;
        document.head.appendChild(link);
      }
      state.iframe = buildIframe();
      if (mode === "inline") mountInline();
      else {
        mountLauncher();
        if (autoOpen) toggle(true);
      }
    })
    .catch(function (err) {
      // Loud in the console, invisible on the page. A broken widget must never
      // leave a stray element on a brand's storefront.
      console.error(
        "[Rovena] Widget yüklenemedi (" + err.message + "). " +
        "En sık sebep: bu alan adı tenant'ın izinli origin listesinde değil."
      );
    });
})();
