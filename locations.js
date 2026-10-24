/* ============================================================
   LOCATIONS REGISTRY  (multi-tenant)
   ------------------------------------------------------------
   The single source of truth for every store the app serves.
   Each location has its own kitchen (KDS) screen, its own
   counter (cashier) screen, its own order-number sequence,
   its own tax rate, and optional per-location menu overrides.

   This file is dual-context: it works as a <script> in the
   browser (sets window.LOCATIONS / window.LOC) AND as a Node
   module (require("./locations")) so the server shares the
   exact same registry — no drift between client and server.

   Add a store: copy a block below, give it a unique `id`
   (used in URLs as ?loc=<id>) and adjust name/tax/menu.
   ============================================================ */

(function (root) {
  "use strict";

  /* Per-location menu overrides:
       unavailable: [itemId, …]   → hidden at this store
       price: { itemId: number }  → price differs at this store
     Anything not listed inherits the base menu in data.js. */
  const LOCATIONS = [
    {
      id: "downtown",
      name: "Faseela",
      address: "City Center",
      taxRate: 0,
      menu: {}, // {} = full base menu at base prices

      /* To open another store later, just add a block like:

         {
           id: "lakeside",                       // used in URLs as ?loc=lakeside
           name: "Faseela Seef",
           address: "8 Harbor Walk · Lake District",
           taxRate: 0.07,                        // this store's tax
           menu: {
             unavailable: ["breakfast-sammie"],  // items this store doesn't carry
             price: { "campfire-mocha": 6.5 },   // this store's price overrides
           },
         }

         Each store automatically gets its own kitchen + counter
         screen, its own order numbers, tax, menu, and QR codes.
         No other code changes needed. */
    },
  ];

  const DEFAULT_LOCATION = LOCATIONS[0].id;
  const byId = {};
  LOCATIONS.forEach((l) => (byId[l.id] = l));

  /* ---------- lookups ---------- */
  function getLocation(id) {
    return byId[id] || null;
  }
  function isValidLocation(id) {
    return !!byId[id];
  }
  function listLocations() {
    return LOCATIONS.map((l) => ({ id: l.id, name: l.name, address: l.address, taxRate: l.taxRate }));
  }

  /* ---------- per-location menu resolution ----------
     Given the shared base menu (from data.js) and a location,
     returns the menu this store actually offers: unavailable
     items removed, overridden prices applied. Used identically
     on the client (for display) and the server (for pricing). */
  function resolveMenu(baseMenu, loc) {
    const ov = (loc && loc.menu) || {};
    const hidden = new Set(ov.unavailable || []);
    const priceOv = ov.price || {};
    return baseMenu
      .filter((m) => !hidden.has(m.id))
      .map((m) => (priceOv[m.id] != null ? Object.assign({}, m, { price: priceOv[m.id] }) : m));
  }

  /* Build a quick { itemId: {name, price} } lookup the server
     trusts when pricing an incoming order for a location. */
  function priceTable(baseMenu, loc) {
    const table = {};
    resolveMenu(baseMenu, loc).forEach((m) => (table[m.id] = { name: m.name, price: m.price }));
    return table;
  }

  const api = {
    LOCATIONS,
    DEFAULT_LOCATION,
    getLocation,
    isValidLocation,
    listLocations,
    resolveMenu,
    priceTable,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.LOCATIONS = LOCATIONS;
    root.LOC_API = api;
  }
})(typeof self !== "undefined" ? self : globalThis);
