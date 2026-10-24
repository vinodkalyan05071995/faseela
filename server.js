/* ============================================================
   FASEELA — multi-store realtime order server
   Zero external deps (Node built-ins + node:sqlite only).

   One central server serves every store. Each store has:
     - its own menu (collections + products)
     - its own kitchen + cashier screens (scoped by ?loc)
     - its own login for the admin dashboard
   A "master" admin (MASTER_USER / MASTER_PASS) manages stores.

   Orders + catalog persist to orders.db (SQLite).
   ============================================================ */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const db = require("./db");
const auth = require("./auth");
const data = require("./data");
const seedLocations = require("./locations").LOCATIONS; // initial stores to create on first boot

const ROOT = __dirname;
const PORT = process.env.PORT || 8100; // default port — override with PORT=
const IMG_DIR = process.env.IMG_DIR || path.join(ROOT, "img");
const MASTER_USER = process.env.MASTER_USER || "admin";
const MASTER_PASS = process.env.MASTER_PASS || "admin";
const STATUSES = ["new", "preparing", "ready", "completed", "cancelled"];

/* seed stores (each copies the base menu) + migrate legacy orders, in order */
db.seedStores(seedLocations, data.CATEGORIES, data.MENU);
const migrated = db.migrateLegacyJson((db.defaultStore() || {}).id);
if (migrated) console.log(`  Migrated ${migrated} legacy order(s) from orders.json → SQLite`);

/* ---------- SSE clients (each remembers its store) ---------- */
const clients = new Set(); // { res, loc }
function broadcast(location, event, payloadData) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(payloadData)}\n\n`;
  for (const c of clients) {
    if (c.loc && c.loc !== location) continue; // scoped to the client's store
    try { c.res.write(payload); } catch { /* dropped */ }
  }
}

/* ---------- helpers ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".webp": "image/webp",
};
function json(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
  });
}
function normalizePhone(v) {
  const d = String(v || "").replace(/\D/g, "").slice(0, 15);
  return d.length >= 7 ? d : null;
}
function withCustomer(order) {
  if (!order) return order;
  return Object.assign({}, order, { customer: order.phone ? db.getCustomer(order.phone) : null });
}
function priceTable(menu) {
  const t = {};
  menu.forEach((m) => (t[m.id] = { name: m.name, price: m.price }));
  return t;
}

/* ---------- auth ---------- */
function sessionOf(req) { return auth.getSession(auth.tokenFromReq(req)); }
/* resolve which store an admin request targets: a store-user is locked to its
   own store; the master may target any store via ?store= (defaults to first). */
function scopeStore(req, parsed) {
  const s = sessionOf(req);
  if (!s) return { code: 401, error: "login required" };
  if (s.role === "master") {
    const id = parsed.query.store || (db.defaultStore() || {}).id;
    if (!db.getStore(id)) return { code: 400, error: "unknown store" };
    return { store: id, role: "master" };
  }
  return { store: s.storeId, role: "store" };
}

/* the client store registry, generated live from the DB */
function genLocationsScript() {
  const stores = db.listStores().map((s) => ({ id: s.id, name: s.name, address: s.address, taxRate: s.taxRate, menu: {} }));
  return "/* generated from the stores table — do not edit */\n" +
    "(function (root) {\n  \"use strict\";\n" +
    "  var LOCATIONS = " + JSON.stringify(stores) + ";\n" +
    "  var DEFAULT_LOCATION = LOCATIONS.length ? LOCATIONS[0].id : null;\n" +
    "  var byId = {}; LOCATIONS.forEach(function (l) { byId[l.id] = l; });\n" +
    "  function getLocation(id) { return byId[id] || null; }\n" +
    "  function isValidLocation(id) { return !!byId[id]; }\n" +
    "  function listLocations() { return LOCATIONS.map(function (l) { return { id: l.id, name: l.name, address: l.address, taxRate: l.taxRate }; }); }\n" +
    "  function resolveMenu(baseMenu, l) { var ov = (l && l.menu) || {}; var hidden = {}; (ov.unavailable || []).forEach(function (x) { hidden[x] = 1; }); var po = ov.price || {}; return baseMenu.filter(function (m) { return !hidden[m.id]; }).map(function (m) { return po[m.id] != null ? Object.assign({}, m, { price: po[m.id] }) : m; }); }\n" +
    "  function priceTable(baseMenu, l) { var t = {}; resolveMenu(baseMenu, l).forEach(function (m) { t[m.id] = { name: m.name, price: m.price }; }); return t; }\n" +
    "  var api = { LOCATIONS: LOCATIONS, DEFAULT_LOCATION: DEFAULT_LOCATION, getLocation: getLocation, isValidLocation: isValidLocation, listLocations: listLocations, resolveMenu: resolveMenu, priceTable: priceTable };\n" +
    "  root.LOCATIONS = LOCATIONS; root.LOC_API = api;\n" +
    "})(typeof self !== 'undefined' ? self : globalThis);\n";
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  // --- generated client store registry ---
  if (pathname === "/locations.js" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(genLocationsScript());
  }

  // --- public store list (no credentials) ---
  if (pathname === "/api/locations" && req.method === "GET") {
    return json(res, 200, db.listStores().map((s) => ({ id: s.id, name: s.name, address: s.address, taxRate: s.taxRate })));
  }

  // --- auth: login / me / logout ---
  if (pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const u = (body.username || "").toString().trim();
    if (u === MASTER_USER && (body.password || "") === MASTER_PASS) {
      const token = auth.createSession({ role: "master" });
      return json(res, 200, { token, role: "master", store: null });
    }
    const store = db.verifyStoreLogin(u, body.password || "");
    if (store) {
      const token = auth.createSession({ role: "store", storeId: store.id, name: store.name });
      return json(res, 200, { token, role: "store", store: { id: store.id, name: store.name } });
    }
    return json(res, 401, { error: "invalid username or password" });
  }
  if (pathname === "/api/me" && req.method === "GET") {
    const s = sessionOf(req);
    if (!s) return json(res, 401, { error: "not logged in" });
    const store = s.role === "store" ? db.getStore(s.storeId) : null;
    return json(res, 200, { role: s.role, store: store ? { id: store.id, name: store.name } : null });
  }
  if (pathname === "/api/logout" && req.method === "POST") {
    auth.destroySession(auth.tokenFromReq(req));
    return json(res, 200, { ok: true });
  }

  // --- master: manage stores ---
  if (pathname === "/api/stores" && req.method === "GET") {
    const s = sessionOf(req);
    if (!s || s.role !== "master") return json(res, 403, { error: "master only" });
    return json(res, 200, db.listStores().map((x) => ({ id: x.id, name: x.name, address: x.address, taxRate: x.taxRate, username: x.username })));
  }
  if (pathname === "/api/stores" && req.method === "POST") {
    const s = sessionOf(req);
    if (!s || s.role !== "master") return json(res, 403, { error: "master only" });
    const body = await readBody(req);
    if (!body.name) return json(res, 400, { error: "store name required" });
    if (!body.username || !body.password) return json(res, 400, { error: "login username and password required" });
    const created = db.createStore(
      { id: body.id || body.username, name: body.name, address: body.address, taxRate: body.taxRate, username: body.username, password: body.password },
      data.CATEGORIES, data.MENU // new store copies the base menu
    );
    if (created && created.error) return json(res, 409, { error: created.error });
    return json(res, 201, created);
  }
  const mstore = pathname.match(/^\/api\/stores\/([^/]+)$/);
  if (mstore && req.method === "DELETE") {
    const s = sessionOf(req);
    if (!s || s.role !== "master") return json(res, 403, { error: "master only" });
    if (db.listStores().length <= 1) return json(res, 400, { error: "can't delete the last store" });
    return db.deleteStore(mstore[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "not found" });
  }

  // --- resolved menu for a store (public; drives the customer menu) ---
  if (pathname === "/api/menu" && req.method === "GET") {
    const store = db.getStore(parsed.query.loc);
    if (!store) return json(res, 400, { error: "unknown store" });
    return json(res, 200, {
      location: { id: store.id, name: store.name, address: store.address, taxRate: store.taxRate },
      categories: db.listCategories(store.id),
      menu: db.listProducts(store.id, true),
    });
  }

  // --- admin catalog (auth + scoped to the logged-in store) ---
  if (pathname === "/api/catalog" && req.method === "GET") {
    const sc = scopeStore(req, parsed);
    if (sc.code) return json(res, sc.code, { error: sc.error });
    return json(res, 200, { store: sc.store, categories: db.listCategories(sc.store), products: db.listProducts(sc.store, false) });
  }
  if (pathname === "/api/products" && req.method === "POST") {
    const sc = scopeStore(req, parsed);
    if (sc.code) return json(res, sc.code, { error: sc.error });
    const body = await readBody(req);
    if (!body.name || !body.cat) return json(res, 400, { error: "name and collection required" });
    return json(res, 201, db.createProduct(sc.store, body));
  }
  const mprod = pathname.match(/^\/api\/products\/([^/]+)$/);
  if (mprod && (req.method === "PATCH" || req.method === "PUT")) {
    const sc = scopeStore(req, parsed);
    if (sc.code) return json(res, sc.code, { error: sc.error });
    const p = db.updateProduct(sc.store, mprod[1], await readBody(req));
    return p ? json(res, 200, p) : json(res, 404, { error: "not found" });
  }
  if (mprod && req.method === "DELETE") {
    const sc = scopeStore(req, parsed);
    if (sc.code) return json(res, sc.code, { error: sc.error });
    return db.deleteProduct(sc.store, mprod[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "not found" });
  }
  if (pathname === "/api/collections" && req.method === "POST") {
    const sc = scopeStore(req, parsed);
    if (sc.code) return json(res, sc.code, { error: sc.error });
    const body = await readBody(req);
    if (!body.label) return json(res, 400, { error: "label required" });
    return json(res, 201, db.createCategory(sc.store, body));
  }
  const mcol = pathname.match(/^\/api\/collections\/([^/]+)$/);
  if (mcol && req.method === "DELETE") {
    const sc = scopeStore(req, parsed);
    if (sc.code) return json(res, sc.code, { error: sc.error });
    return db.deleteCategory(sc.store, mcol[1]) ? json(res, 200, { ok: true }) : json(res, 404, { error: "not found" });
  }

  // --- image upload (any logged-in admin) ---
  if (pathname === "/api/upload" && req.method === "POST") {
    if (!sessionOf(req)) return json(res, 401, { error: "login required" });
    const body = await readBody(req);
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(body.dataUrl || "");
    if (!m) return json(res, 400, { error: "expected a png/jpg/webp image" });
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 4 * 1024 * 1024) return json(res, 413, { error: "image too large (max 4MB)" });
    const base = (body.filename || "photo").toString().toLowerCase()
      .replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "photo";
    const name = base + "-" + Date.now().toString(36) + "." + ext;
    try { fs.mkdirSync(IMG_DIR, { recursive: true }); fs.writeFileSync(path.join(IMG_DIR, name), buf); }
    catch (e) { return json(res, 500, { error: "could not save image" }); }
    return json(res, 201, { path: "img/" + name });
  }
  if (pathname.startsWith("/img/") && req.method === "GET") {
    const rel = path.normalize(pathname.slice(5)).replace(/^(\.\.(\/|\\|$))+/, "");
    const fp = path.join(IMG_DIR, rel);
    if (!fp.startsWith(IMG_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
    return fs.readFile(fp, (err, dataBuf) => {
      if (err) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
      res.end(dataBuf);
    });
  }

  // --- SSE live feed (scoped to ?loc) ---
  if (pathname === "/api/stream" && req.method === "GET") {
    const location = parsed.query.loc && db.getStore(parsed.query.loc) ? parsed.query.loc : null;
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: hello\ndata: {"ok":true}\n\n`);
    const client = { res, loc: location };
    clients.add(client);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
    req.on("close", () => { clearInterval(ping); clients.delete(client); });
    return;
  }

  // --- list orders for a store ---
  if (pathname === "/api/orders" && req.method === "GET") {
    if (!db.getStore(parsed.query.loc)) return json(res, 400, { error: "unknown store" });
    return json(res, 200, db.listOrders(parsed.query.loc, !!parsed.query.active));
  }

  // --- place order ---
  if (pathname === "/api/orders" && req.method === "POST") {
    const body = await readBody(req);
    const store = db.getStore(body.loc);
    if (!store) return json(res, 400, { error: "unknown store" });
    if (!Array.isArray(body.items) || body.items.length === 0) return json(res, 400, { error: "no items" });

    // SERVER-authoritative pricing from THIS store's menu — client prices ignored
    const prices = priceTable(db.listProducts(store.id, true));
    const items = [];
    for (const i of body.items) {
      const ref = prices[i.id];
      const qty = Math.max(1, Math.min(99, parseInt(i.qty, 10) || 0));
      if (!ref || qty <= 0) continue;
      items.push({ id: i.id, name: ref.name, qty, price: ref.price });
    }
    if (items.length === 0) return json(res, 400, { error: "no orderable items for this store" });

    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
    const total = subtotal * (1 + store.taxRate);
    const now = new Date().toISOString();
    const type = body.type === "table" ? "table" : "counter";
    const payMethod = ["online", "counter", "table"].includes(body.paymentMethod)
      ? body.paymentMethod : (type === "table" ? "table" : "counter");
    const paidNow = body.paymentStatus === "paid";
    const num = db.nextNum(store.id);
    const order = {
      id: "o_" + Date.now().toString(36) + "_" + store.id + "_" + num,
      location: store.id, num,
      name: (body.name || "").toString().slice(0, 40).trim() || null,
      phone: normalizePhone(body.phone),
      table: body.table ? String(body.table).replace(/[^0-9A-Za-z]/g, "").slice(0, 4) : null,
      type, items, total, status: "new",
      payment: { method: payMethod, status: paidNow ? "paid" : "unpaid", paidAt: paidNow ? now : null },
      pointsAwarded: 0, placedAt: now, updatedAt: now,
    };
    db.createOrder(order);
    const finalOrder = order.phone && paidNow ? db.syncPoints(order.id, now) : order;
    const enriched = withCustomer(finalOrder);
    broadcast(order.location, "order:new", enriched);
    console.log(`+ [${order.location}] Order #${order.num} (${order.type === "table" ? "Table " + order.table : "counter"}) — ${order.items.reduce((s, i) => s + i.qty, 0)} item(s)${order.phone ? " · ☎ " + order.phone : ""}`);
    return json(res, 201, enriched);
  }

  // --- advance status ---
  const m = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (m && req.method === "POST") {
    const body = await readBody(req);
    if (!STATUSES.includes(body.status)) return json(res, 400, { error: "bad status" });
    const order = db.setStatus(m[1], body.status, new Date().toISOString());
    if (!order) return json(res, 404, { error: "not found" });
    broadcast(order.location, "order:update", order);
    console.log(`  [${order.location}] Order #${order.num} → ${order.status}`);
    return json(res, 200, order);
  }

  // --- mark payment paid/unpaid ---
  const mp = pathname.match(/^\/api\/orders\/([^/]+)\/payment$/);
  if (mp && req.method === "POST") {
    const body = await readBody(req);
    const existing = db.getOrder(mp[1]);
    if (!existing) return json(res, 404, { error: "not found" });
    const method = ["online", "counter", "table", "cash", "card"].includes(body.method) ? body.method : existing.payment.method;
    const status = body.status === "paid" ? "paid" : "unpaid";
    const now = new Date().toISOString();
    db.setPayment(mp[1], method, status, status === "paid" ? now : null, now);
    const order = db.syncPoints(mp[1], now);
    const enriched = withCustomer(order);
    broadcast(order.location, "order:update", enriched);
    console.log(`  [${order.location}] Order #${order.num} payment → ${order.payment.status} (${order.payment.method})${order.pointsAwarded ? " · +" + order.pointsAwarded + "pts" : ""}`);
    return json(res, 200, enriched);
  }

  // --- attach / change loyalty customer on an order ---
  const mc = pathname.match(/^\/api\/orders\/([^/]+)\/customer$/);
  if (mc && req.method === "POST") {
    const body = await readBody(req);
    if (!db.getOrder(mc[1])) return json(res, 404, { error: "not found" });
    const order = db.setOrderCustomer(mc[1], normalizePhone(body.phone), (body.name || "").toString().slice(0, 40).trim() || null, new Date().toISOString());
    const enriched = withCustomer(order);
    broadcast(order.location, "order:update", enriched);
    return json(res, 200, enriched);
  }

  // --- loyalty lookup by phone ---
  const ml = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (ml && req.method === "GET") {
    const phone = normalizePhone(decodeURIComponent(ml[1]));
    if (!phone) return json(res, 400, { error: "bad phone" });
    return json(res, 200, db.getCustomer(phone) || { phone, name: null, points: 0, totalSpent: 0, visits: 0 });
  }

  // --- static files ---
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(filePath, (err, fileData) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(fileData);
  });
});

server.listen(PORT, () => {
  const stores = db.listStores();
  const sample = stores[0] ? stores[0].id : "downtown";
  console.log(`\n  Faseela (multi-store) is live →  http://localhost:${PORT}`);
  console.log(`  Stores: ${stores.map((s) => s.id).join(", ")}`);
  console.log(`  Master admin: ${MASTER_USER} / ${MASTER_PASS}   (set MASTER_USER / MASTER_PASS to change)`);
  console.log(`  Each store's default login: <id> / <id>123  (e.g. ${sample} / ${sample}123)\n`);
  console.log(`  Menu:      http://localhost:${PORT}/  (or /index.html?loc=${sample}&table=7)`);
  console.log(`  Landing:   http://localhost:${PORT}/home.html`);
  console.log(`  Kitchen:   http://localhost:${PORT}/kds.html?loc=${sample}`);
  console.log(`  Cashier:   http://localhost:${PORT}/cashier.html?loc=${sample}`);
  console.log(`  Dashboard: http://localhost:${PORT}/admin.html\n`);
});
