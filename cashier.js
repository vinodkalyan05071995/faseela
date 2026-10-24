/* ============================================================
   FASEELA — Billing / Cashier station
   Live view of every tab: itemized bill, payment status,
   mark paid (cash/card), and printable receipts.
   ============================================================ */

(function () {
  "use strict";

  /* lock this counter screen to one store (shows a picker if ?loc is missing) */
  const STORE = window.resolveStaffLocation();
  if (!STORE) return;
  const LOC = STORE.id;
  document.title = "Billing — " + STORE.name;

  const TAX_RATE = STORE.taxRate;
  const taxPct = parseFloat((TAX_RATE * 100).toFixed(4));
  const cols = { unpaid: document.getElementById("col-unpaid"), paid: document.getElementById("col-paid") };
  const orders = new Map();

  const fmt = (n) => "din " + (n || 0).toFixed(3);
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const subtotalOf = (o) => o.items.reduce((s, i) => s + i.price * i.qty, 0);
  const billOf = (o) => { const sub = subtotalOf(o); const tax = sub * TAX_RATE; return { sub, tax, total: sub + tax }; };

  function whoBlock(o) {
    const cls = o.type === "table" ? "table" : "counter";
    const where = o.type === "table" ? `Table ${o.table}` : "Counter";
    return `<div class="bwho"><span class="tag ${cls}">${where}</span>${o.name ? `<span class="nm">${esc(o.name)}</span>` : ""}</div>`;
  }

  function cardHTML(o) {
    const { sub, tax, total } = billOf(o);
    const paid = o.payment && o.payment.status === "paid";
    const rows = o.items.map((i) => `<tr><td class="q">${i.qty}×</td><td>${esc(i.name)}</td><td class="p">${fmt(i.price * i.qty)}</td></tr>`).join("");
    const method = o.payment ? o.payment.method : "counter";
    const methodLabel = { online: "Paid online", table: "At table", counter: "At counter", cash: "Cash", card: "Card" }[method] || method;
    const actions = paid
      ? `<button class="bbtn ghost" data-print="${o.id}">🧾 Receipt</button>
         <button class="bbtn ghost" data-unpay="${o.id}">Undo</button>`
      : `<button class="bbtn cash" data-pay="${o.id}" data-method="cash">Mark paid · Cash</button>
         <button class="bbtn card" data-pay="${o.id}" data-method="card">Card</button>
         <button class="bbtn ghost" data-print="${o.id}">🧾</button>`;
    return `<div class="bcard" data-id="${o.id}">
      <div class="bcard-top"><span class="bnum">#${o.num}</span>${whoBlock(o)}</div>
      <table class="bill">${rows}</table>
      <div class="bill-tot">
        <div class="r"><span>Subtotal</span><span>${fmt(sub)}</span></div>
        ${taxPct ? `<div class="r"><span>Tax (${taxPct}%)</span><span>${fmt(tax)}</span></div>` : ""}
        <div class="r grand"><span>Total</span><span>${fmt(total)}</span></div>
      </div>
      <div class="bmeta">
        <span class="pill method">${methodLabel}</span>
        <span class="pill ${paid ? "paidp" : "unpaid"}">${paid ? "Paid" : "Unpaid"}</span>
      </div>
      ${loyaltyBlock(o)}
      <div class="bactions">${actions}</div>
    </div>`;
  }

  /* ---------- loyalty: show balance or let staff attach a phone ---------- */
  function loyaltyBlock(o) {
    if (o.phone) {
      const pts = o.customer ? o.customer.points : null;
      const earned = o.pointsAwarded || 0;
      const status = earned
        ? `<span class="lnew">+${earned} earned</span>`
        : `<span class="lpend">+${Math.floor(o.total)} when paid</span>`;
      return `<div class="bloyal has">
        <span class="lph">☎ ${esc(o.phone)}</span>
        ${pts != null ? `<span class="lpts">★ ${pts} pts</span>` : ""}
        ${status}
        <button class="lx" data-detach="${o.id}" title="Remove customer">✕</button>
      </div>`;
    }
    return `<div class="bloyal add">
      <input class="lin" data-phone-for="${o.id}" type="tel" inputmode="numeric"
             maxlength="20" placeholder="Phone for points (optional)" />
      <button class="lbtn" data-attach="${o.id}">Add</button>
    </div>`;
  }

  function render() {
    const unpaid = [], paid = [];
    for (const o of orders.values()) (o.payment && o.payment.status === "paid" ? paid : unpaid).push(o);
    unpaid.sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
    paid.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    cols.unpaid.innerHTML = unpaid.length ? unpaid.map(cardHTML).join("") : `<div class="empty">All settled up ✓</div>`;
    cols.paid.innerHTML = paid.length ? paid.map(cardHTML).join("") : `<div class="empty">No payments yet</div>`;
    document.getElementById("count-unpaid").textContent = unpaid.length;
    document.getElementById("count-paid").textContent = paid.length;
    // summary
    const due = unpaid.reduce((s, o) => s + billOf(o).total, 0);
    const collected = paid.reduce((s, o) => s + billOf(o).total, 0);
    document.getElementById("sDue").textContent = fmt(due);
    document.getElementById("sPaid").textContent = fmt(collected);
    document.getElementById("sOrders").textContent = unpaid.length;
  }

  /* ---------- actions ---------- */
  document.addEventListener("click", async (e) => {
    const pay = e.target.closest("[data-pay]");
    const unpay = e.target.closest("[data-unpay]");
    const print = e.target.closest("[data-print]");
    const attach = e.target.closest("[data-attach]");
    const detach = e.target.closest("[data-detach]");
    if (print) { printReceipt(orders.get(print.dataset.print)); return; }
    if (attach) {
      const input = document.querySelector(`[data-phone-for="${attach.dataset.attach}"]`);
      const phone = input ? input.value.trim() : "";
      if (!phone) { if (input) input.focus(); return; }
      attach.disabled = true;
      await fetch(`/api/orders/${attach.dataset.attach}/customer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      }).catch(() => { attach.disabled = false; });
      return; // UI updates via SSE
    }
    if (detach) {
      await fetch(`/api/orders/${detach.dataset.detach}/customer`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: null }),
      }).catch(() => {});
      return;
    }
    if (pay) {
      pay.disabled = true;
      await fetch(`/api/orders/${pay.dataset.pay}/payment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid", method: pay.dataset.method }),
      }).catch(() => { pay.disabled = false; });
      return; // UI updates via SSE
    }
    if (unpay) {
      unpay.disabled = true;
      await fetch(`/api/orders/${unpay.dataset.unpay}/payment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "unpaid" }),
      }).catch(() => { unpay.disabled = false; });
    }
  });

  /* ---------- printable receipt ---------- */
  function printReceipt(o) {
    if (!o) return;
    const { sub, tax, total } = billOf(o);
    const when = new Date(o.placedAt).toLocaleString();
    const rows = o.items.map((i) => `<tr><td>${i.qty}× ${esc(i.name)}</td><td style="text-align:right">${fmt(i.price * i.qty)}</td></tr>`).join("");
    const paid = o.payment && o.payment.status === "paid";
    const who = o.type === "table" ? `Table ${o.table}` : "Counter pickup";
    const w = window.open("", "receipt", "width=360,height=640");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${o.num}</title>
      <style>
        body{font-family:'Courier New',monospace;color:#1a1a1a;padding:18px;max-width:300px;margin:0 auto}
        h1{font-size:18px;text-align:center;letter-spacing:2px;margin:0 0 2px}
        .sub{text-align:center;font-size:11px;color:#555;margin-bottom:14px}
        .row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0}
        table{width:100%;border-collapse:collapse;font-size:12px;margin:10px 0}
        td{padding:3px 0}
        .hr{border-top:1px dashed #999;margin:8px 0}
        .tot{display:flex;justify-content:space-between;font-weight:bold;font-size:14px;margin-top:6px}
        .stamp{text-align:center;margin-top:14px;font-weight:bold;border:2px solid #1c7d4d;color:#1c7d4d;padding:6px;border-radius:6px}
        .stamp.due{border-color:#a4441d;color:#a4441d}
        .foot{text-align:center;font-size:11px;color:#666;margin-top:16px}
      </style></head><body>
      <h1>FASEELA</h1>
      <div class="sub">${esc(STORE.name)} · Fresh daily</div>
      <div class="row"><span>Order</span><span>#${o.num}</span></div>
      <div class="row"><span>${who}${o.name ? " · " + esc(o.name) : ""}</span><span></span></div>
      <div class="row"><span>${when}</span><span></span></div>
      <div class="hr"></div>
      <table>${rows}</table>
      <div class="hr"></div>
      <div class="row"><span>Subtotal</span><span>${fmt(sub)}</span></div>
      ${taxPct ? `<div class="row"><span>Tax (${taxPct}%)</span><span>${fmt(tax)}</span></div>` : ""}
      <div class="tot"><span>TOTAL</span><span>${fmt(total)}</span></div>
      <div class="stamp ${paid ? "" : "due"}">${paid ? "PAID — " + (o.payment.method || "").toUpperCase() : "PAYMENT DUE"}</div>
      ${o.phone ? `<div class="hr"></div>
        <div class="row"><span>Rewards ☎ ${esc(o.phone)}</span><span>${o.customer ? "★ " + o.customer.points + " pts" : ""}</span></div>
        ${o.pointsAwarded ? `<div class="row"><span>Earned this visit</span><span>+${o.pointsAwarded} pts</span></div>` : ""}` : ""}
      <div class="foot">Thanks for stopping by<br>Faseela</div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 250);
  }

  /* ---------- realtime feed ---------- */
  const live = document.getElementById("live"), liveText = document.getElementById("liveText");
  const setLive = (on) => { live.classList.toggle("on", on); liveText.textContent = on ? "Live" : "Reconnecting…"; };

  const es = new EventSource("/api/stream?loc=" + encodeURIComponent(LOC));
  es.addEventListener("hello", () => setLive(true));
  es.addEventListener("order:new", (ev) => { const o = JSON.parse(ev.data); orders.set(o.id, o); render(); });
  es.addEventListener("order:update", (ev) => {
    const o = JSON.parse(ev.data);
    if (o.status === "cancelled") orders.delete(o.id); else orders.set(o.id, o);
    render();
  });
  es.onopen = () => setLive(true);
  es.onerror = () => setLive(false);

  /* ---------- initial load (all of today's orders, paid + unpaid) ---------- */
  fetch("/api/orders?loc=" + encodeURIComponent(LOC))
    .then((r) => r.json())
    .then((list) => { list.forEach((o) => orders.set(o.id, o)); render(); })
    .catch(() => render());

  render();
})();
