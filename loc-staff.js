/* ============================================================
   STAFF LOCATION GUARD  (kitchen + counter screens)
   ------------------------------------------------------------
   Each store has its own KDS and cashier screen, locked to one
   location via ?loc=<store>. This resolves that location; if it
   is missing/unknown it renders a store picker and returns null
   so the screen waits until a store is chosen (then bookmarked).

   Requires locations.js to be loaded first (window.LOC_API).
   ============================================================ */

(function () {
  "use strict";

  window.resolveStaffLocation = function resolveStaffLocation() {
    const api = window.LOC_API;
    const id = new URLSearchParams(location.search).get("loc");
    let store = api.getLocation(id);
    // single-store setup: nothing to choose — just use it (no picker)
    if (!store && api.LOCATIONS.length === 1) store = api.LOCATIONS[0];
    if (store) {
      patchLinks(store.id); // keep ?loc on cross-screen nav links
      return store;
    }
    renderPicker(api.listLocations());
    return null;
  };

  // append ?loc=<store> to any anchor marked class="loc-link"
  function patchLinks(locId) {
    document.querySelectorAll("a.loc-link").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || href.includes("loc=")) return;
      a.setAttribute("href", href + (href.includes("?") ? "&" : "?") + "loc=" + encodeURIComponent(locId));
    });
  }

  function renderPicker(locs) {
    injectStyles();
    const here = location.pathname.split("/").pop() || "kds.html";
    const cards = locs
      .map(
        (l) => `<a class="loc-pick" href="${here}?loc=${encodeURIComponent(l.id)}">
            <span class="lp-name">${l.name}</span>
            <span class="lp-addr">${l.address}</span>
          </a>`
      )
      .join("");
    const overlay = document.createElement("div");
    overlay.className = "loc-picker-scrim";
    overlay.innerHTML = `<div class="loc-picker">
        <h2>Choose this screen's store</h2>
        <p>This kitchen / counter display shows orders for one location only. Pick yours — then bookmark the page.</p>
        <div class="loc-pick-grid">${cards}</div>
      </div>`;
    document.body.appendChild(overlay);
  }

  function injectStyles() {
    if (document.getElementById("loc-picker-css")) return;
    const s = document.createElement("style");
    s.id = "loc-picker-css";
    s.textContent = `
      .loc-picker-scrim{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;
        background:rgba(8,5,3,.82);backdrop-filter:blur(8px);padding:24px;font-family:'Hanken Grotesk',system-ui,sans-serif;}
      .loc-picker{background:#fff7ec;border:1px solid #e6d6bf;border-radius:20px;max-width:560px;width:100%;
        padding:30px 28px;box-shadow:0 30px 70px -20px rgba(0,0,0,.6);text-align:center;color:#2a1c12;}
      .loc-picker h2{font-family:'Fraunces',serif;font-size:1.55rem;margin:0 0 6px;}
      .loc-picker p{color:#6b5640;font-size:.92rem;margin:0 auto 20px;max-width:42ch;}
      .loc-pick-grid{display:grid;gap:12px;}
      .loc-pick{display:block;text-align:left;text-decoration:none;background:#fff;border:1.5px solid #e6d6bf;
        border-radius:13px;padding:15px 18px;transition:transform .14s,border-color .2s,box-shadow .2s;}
      .loc-pick:hover{transform:translateY(-2px);border-color:#1f4d3a;box-shadow:0 12px 24px -14px rgba(0,0,0,.4);}
      .lp-name{display:block;font-family:'Fraunces',serif;font-weight:600;font-size:1.15rem;color:#1f4d3a;}
      .lp-addr{display:block;font-size:.82rem;color:#6b5640;margin-top:2px;}
    `;
    document.head.appendChild(s);
  }
})();
