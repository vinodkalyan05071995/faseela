/* ============================================================
   FASEELA — customer ordering app
   - Reads ?table=N from the QR URL (counter mode if absent)
   - Renders menu, cart drawer, order placement
   - Persists cart per-table + order history in localStorage
   ============================================================ */

(function () {
  "use strict";

  /* ---------- location + table context from QR url ----------
     QR codes encode ?loc=<store>&table=<n>. An unknown/missing
     loc falls back to the default store so the page still works. */
  const params = new URLSearchParams(location.search);
  const api = window.LOC_API;
  const STORE = api.getLocation(params.get("loc")) || api.getLocation(api.DEFAULT_LOCATION);
  const LOC = STORE.id;
  const TAX_RATE = STORE.taxRate;
  const taxPct = parseFloat((TAX_RATE * 100).toFixed(4)); // e.g. 8, 8.875, 7

  /* menu + collections for this store — loaded from the catalog API on boot,
     so anything edited in the admin dashboard shows up here. */
  let MENU = [];
  let CATEGORIES = [];

  const rawTable = params.get("table");
  const TABLE = rawTable ? String(rawTable).replace(/[^0-9A-Za-z]/g, "").slice(0, 4) : null;
  const isCounter = !TABLE;

  // cart is scoped per store + table so different locations never share a basket
  const CART_KEY = "nw_cart_" + LOC + "_" + (TABLE || "counter");

  /* ---------- SVG placeholder art ---------- */
  const PLATE = `<svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" opacity=".7"/></svg>`;
  // escape user-entered text so product names/descriptions can't break the HTML
  const esc = (s) => String(s == null ? "" : s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  function placeholder(item) {
    const art = PLATE; // food-only menu
    return `<div class="ph" style="background:var(--tone-${esc(item.tone)})">${art}</div>`;
  }
  // render the gradient placeholder, with the real photo layered on top if present;
  // if the photo fails to load it simply removes itself and the placeholder shows.
  function media(item) {
    const ph = placeholder(item);
    if (item.image) return ph + `<img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy" onerror="this.remove()">`;
    return ph;
  }

  /* ---------- state ---------- */
  let cart = load(CART_KEY) || {}; // { itemId: qty }
  let orderType = isCounter ? "counter" : "table";

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  function save() { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
  const fmt = (n) => "din " + (Number(n) || 0).toFixed(3);
  const itemById = (id) => MENU.find((m) => m.id === id);

  /* ---------- table chip / context ---------- */
  const chip = document.getElementById("tableChip");
  const chipText = document.getElementById("tableChipText");
  if (isCounter) {
    chip.classList.add("counter");
    chipText.textContent = "Counter Pickup";
    chip.querySelector("svg").outerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 10h18M5 10v9h14v-9M9 19v-5h6v5"/></svg>`;
  } else {
    chipText.textContent = "Table " + TABLE;
  }
  document.getElementById("drawerContext").textContent =
    STORE.name + (isCounter ? " · Counter pickup" : " · Serving Table " + TABLE);
  document.title = STORE.name === "Faseela" ? "Faseela — Order Menu" : "Faseela — " + STORE.name;
  const otTable = document.getElementById("otTable");
  if (otTable) otTable.textContent = isCounter ? "Unavailable" : "Table " + TABLE;
  if (isCounter) {
    document.getElementById("heroLede").textContent =
      "Order ahead and skip the line — build your order here, then pick it up warm at the counter. Sitting down? Scan the QR code on your table to have it brought over.";
  }

  /* ---------- spotlight (a featured item, picked after catalog loads) ---------- */
  function renderSpotlight() {
    const spot = itemById("campfire-mocha") || MENU.find((m) => m.cat === "featured") || MENU[0];
    const ph = document.getElementById("spotlightPh");
    if (!spot || !ph) return;
    ph.outerHTML = media(spot, true).replace('class="ph"', 'class="ph" id="spotlightPh"');
    const sp = document.querySelector(".spotlight .ph, .spotlight img");
    if (sp) { sp.style.position = "absolute"; sp.style.inset = 0; sp.style.width = "100%"; sp.style.height = "100%"; }
    const label = document.querySelector(".spotlight-label");
    if (label) {
      const n = label.querySelector(".n"), p = label.querySelector(".p");
      if (n) n.textContent = spot.name;
      if (p) p.textContent = fmt(spot.price);
    }
  }

  /* ---------- category nav + menu (rendered once the catalog is loaded) ---------- */
  const catnav = document.getElementById("catnav");
  const menuRoot = document.getElementById("menuRoot");
  const visibleCats = () => CATEGORIES.filter((c) => MENU.some((m) => m.cat === c.id));

  function renderMenu() {
    const cats = visibleCats();
    catnav.innerHTML = cats.map(
      (c, i) => `<button class="cattab${i === 0 ? " active" : ""}" data-cat="${c.id}">${c.label}</button>`
    ).join("");
    menuRoot.innerHTML = cats.map((c) => {
      const items = MENU.filter((m) => m.cat === c.id);
      const cards = items
        .map(
          (m, idx) => `
      <article class="card" data-id="${m.id}" style="animation-delay:${idx * 60}ms">
        <div class="card-img">
          ${m.badge ? `<span class="badge ${esc(m.badge).replace(/\s/g, ".")}">${esc(m.badge)}</span>` : ""}
          ${media(m)}
        </div>
        <div class="card-body">
          <div class="card-title"><h3>${esc(m.name)}</h3><span class="price">${fmt(m.price)}</span></div>
          <p class="card-desc">${esc(m.desc || "")}</p>
          <div class="card-meta">
            <span class="cal">${m.cal ? m.cal + " cal" : ""}</span>
            <span class="card-action" data-action-for="${m.id}"></span>
          </div>
        </div>
      </article>`
        )
        .join("");
      return `<section class="section" id="${c.id}">
      <div class="section-head"><h2>${c.label}</h2><span class="note">${c.note || ""}</span></div>
      <div class="menu-grid">${cards}</div>
    </section>`;
    }).join("");
  }

  /* ---------- per-card add / stepper ---------- */
  function renderCardAction(id) {
    const slot = document.querySelector(`[data-action-for="${id}"]`);
    if (!slot) return;
    const qty = cart[id] || 0;
    if (qty === 0) {
      slot.innerHTML = `<button class="add-btn" data-add="${id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M12 5v14M5 12h14"/></svg>Add</button>`;
    } else {
      slot.innerHTML = `<span class="stepper">
        <button data-dec="${id}">–</button><span class="q">${qty}</span><button data-inc="${id}">+</button>
      </span>`;
    }
  }
  function renderAllCardActions() { MENU.forEach((m) => renderCardAction(m.id)); }

  /* ---------- cart mutations ---------- */
  function add(id) {
    cart[id] = (cart[id] || 0) + 1;
    save(); renderCardAction(id); renderCart(); bumpCount(); toast(itemById(id).name + " added");
  }
  function setQty(id, q) {
    if (q <= 0) delete cart[id]; else cart[id] = q;
    save(); renderCardAction(id); renderCart(); bumpCount();
  }

  /* ---------- counts / totals ---------- */
  const cartCount = document.getElementById("cartCount");
  function totalQty() { return Object.values(cart).reduce((a, b) => a + b, 0); }
  function bumpCount() {
    const n = totalQty();
    cartCount.textContent = n;
    cartCount.classList.toggle("show", n > 0);
  }
  function subtotal() { return Object.entries(cart).reduce((s, [id, q]) => s + itemById(id).price * q, 0); }

  /* ---------- cart drawer render ---------- */
  const cartItems = document.getElementById("cartItems");
  const drawerFoot = document.getElementById("drawerFoot");
  function renderCart() {
    const ids = Object.keys(cart);
    if (ids.length === 0) {
      cartItems.innerHTML = `<div class="cart-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6 5 2H2"/><circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/></svg>
        <p>Your order is empty.<br>Tap <strong>Add</strong> on anything tasty.</p></div>`;
      drawerFoot.hidden = true;
      return;
    }
    cartItems.innerHTML = ids.map((id) => {
      const m = itemById(id), q = cart[id];
      return `<div class="cart-line">
        <div class="thumb">${media(m)}</div>
        <div class="info">
          <h4>${esc(m.name)}</h4>
          <div class="lp">${fmt(m.price * q)}</div>
        </div>
        <span class="stepper">
          <button data-dec="${id}">–</button><span class="q">${q}</span><button data-inc="${id}">+</button>
        </span>
      </div>`;
    }).join("");
    drawerFoot.hidden = false;
    const sub = subtotal(), tax = sub * TAX_RATE;
    document.getElementById("tSub").textContent = fmt(sub);
    const taxLabel = document.getElementById("taxLabel");
    if (taxLabel) {
      taxLabel.textContent = taxPct ? "Tax (" + taxPct + "%)" : "Tax";
      const taxRow = taxLabel.closest(".row");
      if (taxRow) taxRow.hidden = !taxPct; // hide the tax line when there's no tax
    }
    document.getElementById("tTax").textContent = fmt(tax);
    document.getElementById("tGrand").textContent = fmt(sub + tax);
    if (typeof updatePlaceLabel === "function") updatePlaceLabel();
  }

  /* ---------- drawer open/close ---------- */
  const scrim = document.getElementById("scrim");
  const drawer = document.getElementById("drawer");
  function openCart() { scrim.classList.add("open"); drawer.classList.add("open"); }
  function closeCart() { scrim.classList.remove("open"); drawer.classList.remove("open"); }
  document.getElementById("cartBtn").addEventListener("click", openCart);
  document.getElementById("drawerClose").addEventListener("click", closeCart);
  scrim.addEventListener("click", closeCart);
  document.getElementById("howBtn")?.addEventListener("click", openCart);

  /* ---------- order type toggle ---------- */
  document.getElementById("orderType").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-type]");
    if (!btn) return;
    if (btn.dataset.type === "table" && isCounter) { toast("Scan a table QR to dine in"); return; }
    orderType = btn.dataset.type;
    document.querySelectorAll("#orderType button").forEach((b) => b.classList.toggle("active", b === btn));
    refreshPayLabels();
  });

  /* ---------- name + phone fields (both optional) ---------- */
  const nameInput = document.getElementById("custName");
  nameInput.value = localStorage.getItem("nw_name") || "";
  nameInput.addEventListener("input", () => localStorage.setItem("nw_name", nameInput.value.trim()));

  const phoneInput = document.getElementById("custPhone");
  if (phoneInput) {
    phoneInput.value = localStorage.getItem("nw_phone") || "";
    phoneInput.addEventListener("input", () => localStorage.setItem("nw_phone", phoneInput.value.trim()));
  }

  /* ---------- live order status (SSE) ---------- */
  let activeOrderId = null;
  const trackerSteps = ["new", "preparing", "ready"];
  function setTracker(status) {
    const idx = trackerSteps.indexOf(status === "completed" ? "ready" : status);
    document.querySelectorAll("#tracker .step").forEach((stepEl, i) => {
      stepEl.classList.toggle("done", i < idx);
      stepEl.classList.toggle("active", i === idx);
    });
  }
  function statusMessage(o) {
    if (o.status === "preparing") return "Our baristas are crafting your order…";
    if (o.status === "ready")
      return o.type === "table" ? `On its way to Table ${o.table} now!` : "Ready! Head to the counter to grab it.";
    if (o.status === "completed") return "Enjoy — thanks for ordering with us!";
    return o.type === "table"
      ? `Sent to the kitchen — we'll bring it to Table ${o.table}.`
      : `Sent to the kitchen — listen for ${o.name ? `"${o.name}"` : "your number"} at the counter.`;
  }
  function setPaidLine(o) {
    const el = document.getElementById("paidLine");
    const amt = fmt(o.total || 0);
    if (o.payment && o.payment.status === "paid") {
      el.className = "paidline paid";
      el.innerHTML = `✓ Paid ${amt} — you're all set.`;
    } else {
      el.className = "paidline due";
      el.innerHTML = o.type === "table"
        ? `Pay ${amt} at your table or the counter — quote order #${o.num}.`
        : `Pay ${amt} at the counter — quote order #${o.num}.`;
    }
  }
  function setLoyaltyLine(o) {
    const el = document.getElementById("loyaltyLine");
    if (!el) return;
    if (!o.phone) { el.hidden = true; return; } // skipped loyalty — nothing to show
    el.hidden = false;
    const earned = o.pointsAwarded || 0;
    const bal = o.customer ? o.customer.points : null;
    if (earned > 0) {
      el.innerHTML = `★ You earned ${earned} point${earned === 1 ? "" : "s"}!` +
        (bal != null ? `<span class="bal">Rewards balance: ${bal} points</span>` : "");
    } else {
      const pending = Math.floor(o.total || 0);
      el.innerHTML = `★ Earn ${pending} point${pending === 1 ? "" : "s"} when you pay` +
        (bal ? `<span class="bal">Current balance: ${bal} points</span>` : "");
    }
  }
  function showConfirm(o) {
    document.getElementById("confirmNum").textContent = "#" + o.num;
    document.getElementById("confirmMsg").textContent = statusMessage(o);
    document.getElementById("confirmEta").textContent = "Ready in ~" + (6 + o.items.length) + " min";
    setTracker(o.status);
    setPaidLine(o);
    setLoyaltyLine(o);
    document.getElementById("confirmScrim").classList.add("open");
  }
  function updateConfirm(o) {
    document.getElementById("confirmMsg").textContent = statusMessage(o);
    setTracker(o.status);
    setPaidLine(o);
    setLoyaltyLine(o);
    if (o.status === "ready") { chime(); toast(o.type === "table" ? "Your order is on its way!" : "Your order is ready!"); }
  }
  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      o.start(); o.stop(ctx.currentTime + 0.5);
    } catch {}
  }
  try {
    const es = new EventSource("/api/stream?loc=" + encodeURIComponent(LOC));
    es.addEventListener("order:update", (ev) => {
      const o = JSON.parse(ev.data);
      if (o.id === activeOrderId) updateConfirm(o);
    });
  } catch {}

  /* ---------- payment method ---------- */
  let payMethod = "later"; // 'later' = pay at counter/table · 'online' = pay now
  const placeBtn = document.getElementById("placeBtn");
  function grandTotal() { return subtotal() * (1 + TAX_RATE); }
  function updatePlaceLabel() {
    const t = fmt(grandTotal());
    placeBtn.textContent = payMethod === "online" ? `Pay & Place · ${t}` : `Place Order · ${t}`;
  }
  function refreshPayLabels() {
    document.getElementById("ptLater").textContent = orderType === "table" ? "Cash/card at your table" : "Cash or card";
    updatePlaceLabel();
  }
  document.getElementById("payType").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-pay]");
    if (!btn) return;
    payMethod = btn.dataset.pay;
    document.querySelectorAll("#payType button").forEach((b) => b.classList.toggle("active", b === btn));
    updatePlaceLabel();
  });

  /* ---------- submit order to server ---------- */
  async function submitOrder(extra) {
    const payload = {
      loc: LOC,
      name: nameInput.value.trim() || null,
      phone: phoneInput ? phoneInput.value.trim() || null : null,
      table: orderType === "table" ? TABLE : null,
      type: orderType,
      items: Object.entries(cart).map(([id, q]) => ({ id, name: itemById(id).name, qty: q, price: itemById(id).price })),
      total: grandTotal(),
      ...extra,
    };
    const res = await fetch("/api/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("bad response");
    const order = await res.json();
    activeOrderId = order.id;
    showConfirm(order);
    cart = {}; save(); renderCart(); renderAllCardActions(); bumpCount(); closeCart();
  }
  function needsName() {
    // name + phone are both optional — never block placing an order
    return false;
  }

  /* ---------- place order (pay later) or open card modal (pay now) ---------- */
  placeBtn.addEventListener("click", async () => {
    if (totalQty() === 0 || needsName()) return;
    if (payMethod === "online") { openPay(); return; }
    placeBtn.disabled = true;
    placeBtn.textContent = "Sending to the kitchen…";
    try {
      await submitOrder({ paymentMethod: orderType === "table" ? "table" : "counter", paymentStatus: "unpaid" });
    } catch (err) {
      toast("Couldn't reach the kitchen — is the server running?");
    } finally {
      placeBtn.disabled = false; updatePlaceLabel();
    }
  });

  /* ---------- pay now (mock card) ---------- */
  const payScrim = document.getElementById("payScrim");
  function openPay() {
    document.getElementById("payAmount").textContent = grandTotal().toFixed(3);
    document.getElementById("payAmount2").textContent = grandTotal().toFixed(3);
    payScrim.classList.add("open");
  }
  document.getElementById("payCancel").addEventListener("click", () => payScrim.classList.remove("open"));
  document.getElementById("ccNum").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
  });
  document.getElementById("ccExp").addEventListener("input", (e) => {
    let v = e.target.value.replace(/\D/g, "").slice(0, 4);
    if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    e.target.value = v;
  });
  document.getElementById("payForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("payNowBtn");
    const restore = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Processing…";
    try {
      await new Promise((r) => setTimeout(r, 700)); // simulate a payment gateway round-trip
      await submitOrder({ paymentMethod: "online", paymentStatus: "paid" });
      payScrim.classList.remove("open");
      e.target.reset();
    } catch (err) {
      toast("Payment couldn't be processed — try again.");
    } finally {
      btn.disabled = false; btn.innerHTML = restore;
    }
  });

  document.getElementById("confirmDone").addEventListener("click", () =>
    document.getElementById("confirmScrim").classList.remove("open")
  );

  /* ---------- global click delegation for add/inc/dec ---------- */
  document.addEventListener("click", (e) => {
    const add$ = e.target.closest("[data-add]");
    const inc$ = e.target.closest("[data-inc]");
    const dec$ = e.target.closest("[data-dec]");
    if (add$) return add(add$.dataset.add);
    if (inc$) return setQty(inc$.dataset.inc, (cart[inc$.dataset.inc] || 0) + 1);
    if (dec$) return setQty(dec$.dataset.dec, (cart[dec$.dataset.dec] || 0) - 1);
  });

  /* ---------- toast ---------- */
  let toastTimer;
  const toastEl = document.getElementById("toast");
  function toast(msg) {
    document.getElementById("toastText").textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  /* ---------- category nav: scroll + scrollspy ---------- */
  catnav.addEventListener("click", (e) => {
    const tab = e.target.closest(".cattab");
    if (!tab) return;
    const el = document.getElementById(tab.dataset.cat);
    const y = el.getBoundingClientRect().top + window.scrollY - 120;
    window.scrollTo({ top: y, behavior: "smooth" });
  });
  function setupScrollspy() {
    const tabs = [...document.querySelectorAll(".cattab")];
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            tabs.forEach((t) => t.classList.toggle("active", t.dataset.cat === en.target.id));
            const active = catnav.querySelector(".cattab.active");
            if (active) active.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
          }
        });
      },
      { rootMargin: "-130px 0px -65% 0px" }
    );
    visibleCats().forEach((c) => { const el = document.getElementById(c.id); if (el) spy.observe(el); });
  }

  /* ---------- boot: load the catalog for this store, then render ---------- */
  async function boot() {
    try {
      const r = await fetch("/api/menu?loc=" + encodeURIComponent(LOC));
      const dataResp = await r.json();
      MENU = dataResp.menu || [];
      CATEGORIES = dataResp.categories || [];
    } catch {
      // fallback to the static bundle if the API is unreachable
      MENU = api.resolveMenu(window.MENU || [], STORE);
      CATEGORIES = window.CATEGORIES || [];
    }
    // drop any saved cart items that no longer exist in the catalog
    Object.keys(cart).forEach((id) => { if (!itemById(id)) delete cart[id]; });
    save();

    renderSpotlight();
    renderMenu();
    setupScrollspy();
    renderAllCardActions();
    renderCart();
    bumpCount();
    refreshPayLabels();
  }
  boot();
})();
