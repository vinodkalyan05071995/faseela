/* ============================================================
   FASEELA — Kitchen / Counter Display (KDS)
   Subscribes to the server's SSE feed and shows every order
   the instant it's placed, grouped New → Preparing → Ready.
   "Who placed it" = Table number (dine-in) or Name (counter).
   ============================================================ */

(function () {
  "use strict";

  /* lock this kitchen screen to one store (shows a picker if ?loc is missing) */
  const STORE = window.resolveStaffLocation();
  if (!STORE) return;
  const LOC = STORE.id;
  document.title = "Kitchen — " + STORE.name;

  const cols = {
    new: document.getElementById("col-new"),
    preparing: document.getElementById("col-preparing"),
    ready: document.getElementById("col-ready"),
  };
  const orders = new Map();
  let soundOn = true;

  const fmtTime = (iso) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    return mins < 1 ? "just now" : mins + " min ago";
  };
  const isLate = (iso) => (Date.now() - new Date(iso).getTime()) > 10 * 60000;

  /* ---------- who placed it ---------- */
  function whoBlock(o) {
    if (o.type === "table") {
      return `<div class="kwho"><span class="tag table">Table ${o.table}</span>${o.name ? `<span class="nm">${esc(o.name)}</span>` : ""}</div>`;
    }
    return `<div class="kwho"><span class="tag counter">Counter</span><span class="nm">${o.name ? esc(o.name) : "Guest"}</span></div>`;
  }
  function esc(s) { return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

  function cardHTML(o) {
    const items = o.items.map((i) => `<li><b>${i.qty}×</b> <span>${esc(i.name)}</span></li>`).join("");
    let action = "";
    if (o.status === "new") action = `<button class="adv" data-id="${o.id}" data-to="preparing">Start preparing →</button>`;
    else if (o.status === "preparing") action = `<button class="adv ready" data-id="${o.id}" data-to="ready">Mark ready →</button>`;
    else if (o.status === "ready") action = `<button class="adv done" data-id="${o.id}" data-to="completed">${o.type === "table" ? "Delivered ✓" : "Picked up ✓"}</button>`;
    return `<div class="kcard ${o.status}" data-id="${o.id}">
      <div class="kcard-top"><span class="knum">#${o.num}</span>${whoBlock(o)}</div>
      <ul class="kitems">${items}</ul>
      <div class="kcard-foot">
        <span class="ktime ${isLate(o.placedAt) ? "late" : ""}" data-since="${o.placedAt}">${fmtTime(o.placedAt)}</span>
        ${action}
      </div>
    </div>`;
  }

  function render() {
    const buckets = { new: [], preparing: [], ready: [] };
    for (const o of orders.values()) if (buckets[o.status]) buckets[o.status].push(o);
    for (const k of Object.keys(cols)) {
      buckets[k].sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
      cols[k].innerHTML = buckets[k].length ? buckets[k].map(cardHTML).join("") : `<div class="empty">No orders</div>`;
      document.getElementById("count-" + k).textContent = buckets[k].length;
    }
  }

  /* ---------- advance status ---------- */
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".adv");
    if (!btn) return;
    btn.disabled = true;
    try {
      await fetch(`/api/orders/${btn.dataset.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: btn.dataset.to }),
      });
      // UI updates arrive via the SSE feed (single source of truth)
    } catch {
      btn.disabled = false;
    }
  });

  /* ---------- realtime feed ---------- */
  const live = document.getElementById("live");
  const liveText = document.getElementById("liveText");
  function setLive(on) {
    live.classList.toggle("on", on);
    liveText.textContent = on ? "Live" : "Reconnecting…";
  }

  function connect() {
    const es = new EventSource("/api/stream?loc=" + encodeURIComponent(LOC));
    es.addEventListener("hello", () => setLive(true));
    es.addEventListener("order:new", (ev) => {
      const o = JSON.parse(ev.data);
      orders.set(o.id, o);
      render();
      beep();
    });
    es.addEventListener("order:update", (ev) => {
      const o = JSON.parse(ev.data);
      if (o.status === "completed" || o.status === "cancelled") orders.delete(o.id);
      else orders.set(o.id, o);
      render();
    });
    es.onopen = () => setLive(true);
    es.onerror = () => { setLive(false); /* EventSource auto-reconnects */ };
  }

  /* ---------- initial load ---------- */
  fetch("/api/orders?active=1&loc=" + encodeURIComponent(LOC))
    .then((r) => r.json())
    .then((list) => { list.forEach((o) => orders.set(o.id, o)); render(); })
    .catch(() => render());

  /* ---------- live elapsed timers ---------- */
  setInterval(() => {
    document.querySelectorAll(".ktime").forEach((el) => {
      el.textContent = fmtTime(el.dataset.since);
      el.classList.toggle("late", isLate(el.dataset.since));
    });
  }, 15000);

  /* ---------- new-order chime ---------- */
  function beep() {
    if (!soundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1175].forEach((freq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = freq;
        const t = ctx.currentTime + i * 0.14;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        o.start(t); o.stop(t + 0.34);
      });
    } catch {}
  }

  const soundBtn = document.getElementById("soundToggle");
  soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? "🔔 Sound: On" : "🔕 Sound: Off";
    if (soundOn) beep(); // also unlocks AudioContext on first gesture
  });

  connect();
  render();
})();
