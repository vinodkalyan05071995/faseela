/* ============================================================
   ORDER STORE — SQLite (Node built-in node:sqlite, zero deps)
   ------------------------------------------------------------
   Replaces the old single orders.json blob. Safe for many
   locations writing concurrently and survives restarts/redeploys.

   Every order carries a `location`. Order numbers are sequenced
   PER LOCATION (Downtown #101, Airport #101 …) via the counters
   table. The wire shape returned to clients is unchanged from
   the original server, plus a `location` field.

   On first run it migrates any legacy orders.json into the DB
   under DEFAULT_LOCATION so existing data isn't lost.
   ============================================================ */

const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DB_FILE = process.env.DB_FILE || path.join(ROOT, "faseela.db"); // Faseela store DB
const LEGACY_JSON = path.join(ROOT, "orders.json");
const START_NUM = 101;

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS orders (
    id          TEXT PRIMARY KEY,
    location    TEXT NOT NULL,
    num         INTEGER NOT NULL,
    name        TEXT,
    phone       TEXT,
    tbl         TEXT,
    type        TEXT NOT NULL,
    items       TEXT NOT NULL,           -- JSON array
    total       REAL NOT NULL,
    status      TEXT NOT NULL,
    pay_method  TEXT NOT NULL,
    pay_status  TEXT NOT NULL,
    pay_paid_at TEXT,
    points_awarded INTEGER NOT NULL DEFAULT 0,  -- loyalty points granted for this order
    placed_at   TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_loc ON orders(location, status);
  CREATE TABLE IF NOT EXISTS counters (
    location TEXT PRIMARY KEY,
    next_num INTEGER NOT NULL
  );
  -- loyalty: one row per customer (keyed by phone), points are brand-wide
  CREATE TABLE IF NOT EXISTS customers (
    phone       TEXT PRIMARY KEY,
    name        TEXT,
    points      INTEGER NOT NULL DEFAULT 0,
    total_spent REAL NOT NULL DEFAULT 0,
    visits      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT,
    updated_at  TEXT
  );
`);

/* lightweight migration: add loyalty columns to a pre-existing orders table */
function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`);
}
ensureColumn("orders", "phone", "phone TEXT");
ensureColumn("orders", "points_awarded", "points_awarded INTEGER NOT NULL DEFAULT 0");

const POINTS_PER_DOLLAR = 1; // 1 point per 1 din of the paid total

/* ---------- stores (with per-store login) + per-store catalog ---------- */
function tableExists(t) { return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t); }
function tableHasColumn(t, c) { try { return db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c); } catch { return false; } }
// upgrade old GLOBAL catalog tables → per-store schema (only seed/demo data, safe to drop)
if (tableExists("products") && !tableHasColumn("products", "store")) db.exec("DROP TABLE products");
if (tableExists("categories") && !tableHasColumn("categories", "store")) db.exec("DROP TABLE categories");

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    address   TEXT,
    tax_rate  REAL NOT NULL DEFAULT 0.08,
    username  TEXT,
    pass_salt TEXT,
    pass_hash TEXT,
    sort      INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS categories (
    store TEXT NOT NULL,
    id    TEXT NOT NULL,
    label TEXT NOT NULL,
    note  TEXT,
    sort  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (store, id)
  );
  CREATE TABLE IF NOT EXISTS products (
    store     TEXT NOT NULL,
    id        TEXT NOT NULL,
    cat       TEXT NOT NULL,
    name      TEXT NOT NULL,
    price     REAL NOT NULL DEFAULT 0,
    descr     TEXT,
    cal       INTEGER,
    tone      TEXT,
    badge     TEXT,
    image     TEXT,
    available INTEGER NOT NULL DEFAULT 1,
    sort      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (store, id)
  );
  CREATE INDEX IF NOT EXISTS idx_products_store ON products(store, cat, sort);
`);

/* ---------- prepared statements ---------- */
const stmt = {
  insert: db.prepare(`INSERT INTO orders
    (id, location, num, name, phone, tbl, type, items, total, status, pay_method, pay_status, pay_paid_at, points_awarded, placed_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
  byId: db.prepare(`SELECT * FROM orders WHERE id = ?`),
  listActive: db.prepare(
    `SELECT * FROM orders WHERE location = ? AND status NOT IN ('completed','cancelled') ORDER BY placed_at ASC`
  ),
  listAll: db.prepare(`SELECT * FROM orders WHERE location = ? ORDER BY placed_at ASC`),
  setStatus: db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`),
  setPayment: db.prepare(
    `UPDATE orders SET pay_method = ?, pay_status = ?, pay_paid_at = ?, updated_at = ? WHERE id = ?`
  ),
  setCustomerOnOrder: db.prepare(`UPDATE orders SET phone = ?, name = COALESCE(?, name), updated_at = ? WHERE id = ?`),
  setAwarded: db.prepare(`UPDATE orders SET points_awarded = ? WHERE id = ?`),
  getCounter: db.prepare(`SELECT next_num FROM counters WHERE location = ?`),
  upsertCounter: db.prepare(
    `INSERT INTO counters(location, next_num) VALUES(?, ?)
     ON CONFLICT(location) DO UPDATE SET next_num = excluded.next_num`
  ),
  getCustomer: db.prepare(`SELECT * FROM customers WHERE phone = ?`),
  upsertCustomer: db.prepare(
    `INSERT INTO customers(phone, name, points, total_spent, visits, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       name = COALESCE(excluded.name, customers.name),
       points = customers.points + excluded.points,
       total_spent = customers.total_spent + excluded.total_spent,
       visits = customers.visits + excluded.visits,
       updated_at = excluded.updated_at`
  ),
};

/* ---------- row <-> wire shape ---------- */
function rowToOrder(r) {
  if (!r) return null;
  return {
    id: r.id,
    location: r.location,
    num: r.num,
    name: r.name,
    phone: r.phone || null,
    table: r.tbl,
    type: r.type,
    items: JSON.parse(r.items),
    total: r.total,
    status: r.status,
    payment: { method: r.pay_method, status: r.pay_status, paidAt: r.pay_paid_at },
    pointsAwarded: r.points_awarded || 0,
    placedAt: r.placed_at,
    updatedAt: r.updated_at,
  };
}

/* ---------- per-location order numbering ---------- */
function nextNum(location) {
  const row = stmt.getCounter.get(location);
  const n = row ? row.next_num : START_NUM;
  stmt.upsertCounter.run(location, n + 1);
  return n;
}

/* ---------- public API ---------- */
function createOrder(o) {
  stmt.insert.run(
    o.id, o.location, o.num, o.name, o.phone || null, o.table, o.type,
    JSON.stringify(o.items), o.total, o.status,
    o.payment.method, o.payment.status, o.payment.paidAt, 0,
    o.placedAt, o.updatedAt
  );
  return o;
}

function listOrders(location, activeOnly) {
  const rows = (activeOnly ? stmt.listActive : stmt.listAll).all(location);
  return rows.map(rowToOrder);
}

function getOrder(id) {
  return rowToOrder(stmt.byId.get(id));
}

function setStatus(id, status, updatedAt) {
  const res = stmt.setStatus.run(status, updatedAt, id);
  return res.changes ? getOrder(id) : null;
}

function setPayment(id, method, status, paidAt, updatedAt) {
  const res = stmt.setPayment.run(method, status, paidAt, updatedAt, id);
  return res.changes ? getOrder(id) : null;
}

/* ---------- loyalty ---------- */
function getCustomer(phone) {
  if (!phone) return null;
  const r = stmt.getCustomer.get(phone);
  if (!r) return null;
  return { phone: r.phone, name: r.name, points: r.points, totalSpent: r.total_spent, visits: r.visits };
}

/* Reconcile an order's points with reality: a paid order that has a phone
   should have earned floor(total) points exactly once; anything else should
   have none. Idempotent — safe to call after any payment/customer change. */
function syncPoints(id, now) {
  const o = getOrder(id);
  if (!o) return null;
  const shouldEarn = o.payment.status === "paid" && !!o.phone;
  if (shouldEarn && o.pointsAwarded === 0) {
    const pts = Math.floor(o.total) * POINTS_PER_DOLLAR;
    stmt.upsertCustomer.run(o.phone, o.name || null, pts, o.total, 1, now, now);
    stmt.setAwarded.run(pts, id);
  } else if (!shouldEarn && o.pointsAwarded > 0) {
    stmt.upsertCustomer.run(o.phone, o.name || null, -o.pointsAwarded, -o.total, -1, now, now);
    stmt.setAwarded.run(0, id);
  }
  return getOrder(id);
}

/* Attach (or change) the customer on an order. Unwinds any prior award first
   so points always follow the current phone, then re-syncs. */
function setOrderCustomer(id, phone, name, now) {
  const before = getOrder(id);
  if (!before) return null;
  if (before.pointsAwarded > 0) {
    stmt.upsertCustomer.run(before.phone, before.name || null, -before.pointsAwarded, -before.total, -1, now, now);
    stmt.setAwarded.run(0, id);
  }
  stmt.setCustomerOnOrder.run(phone || null, name || null, now, id);
  return syncPoints(id, now);
}

/* ============================================================
   STORES + per-store CATALOG. Each store owns its own
   collections + products. A new store copies the base menu
   (data.js) so it's usable immediately, then edits its own.
   ============================================================ */
const auth = require("./auth");

const cat = {
  countCats: db.prepare(`SELECT COUNT(*) c FROM categories WHERE store=?`),
  countProds: db.prepare(`SELECT COUNT(*) c FROM products WHERE store=?`),
  insCat: db.prepare(`INSERT OR IGNORE INTO categories(store,id,label,note,sort) VALUES(?,?,?,?,?)`),
  insProd: db.prepare(`INSERT OR IGNORE INTO products(store,id,cat,name,price,descr,cal,tone,badge,image,available,sort)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`),
  allCats: db.prepare(`SELECT * FROM categories WHERE store=? ORDER BY sort, label`),
  allProds: db.prepare(`SELECT * FROM products WHERE store=? ORDER BY sort, name`),
  availProds: db.prepare(`SELECT * FROM products WHERE store=? AND available=1 ORDER BY sort, name`),
  getProd: db.prepare(`SELECT * FROM products WHERE store=? AND id=?`),
  delProd: db.prepare(`DELETE FROM products WHERE store=? AND id=?`),
  getCat: db.prepare(`SELECT * FROM categories WHERE store=? AND id=?`),
  delCat: db.prepare(`DELETE FROM categories WHERE store=? AND id=?`),
  delProdsInCat: db.prepare(`DELETE FROM products WHERE store=? AND cat=?`),
  maxProdSort: db.prepare(`SELECT COALESCE(MAX(sort),0) m FROM products WHERE store=?`),
  maxCatSort: db.prepare(`SELECT COALESCE(MAX(sort),0) m FROM categories WHERE store=?`),
};
const storeStmt = {
  count: db.prepare(`SELECT COUNT(*) c FROM stores`),
  ins: db.prepare(`INSERT OR IGNORE INTO stores(id,name,address,tax_rate,username,pass_salt,pass_hash,sort) VALUES(?,?,?,?,?,?,?,?)`),
  all: db.prepare(`SELECT * FROM stores ORDER BY sort, name`),
  get: db.prepare(`SELECT * FROM stores WHERE id=?`),
  byUser: db.prepare(`SELECT * FROM stores WHERE username=?`),
  del: db.prepare(`DELETE FROM stores WHERE id=?`),
  setCreds: db.prepare(`UPDATE stores SET username=?, pass_salt=?, pass_hash=? WHERE id=?`),
  maxSort: db.prepare(`SELECT COALESCE(MAX(sort),0) m FROM stores`),
};

function slugify(s) {
  return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
function rowToProduct(r) {
  return {
    id: r.id, cat: r.cat, name: r.name, price: r.price,
    desc: r.descr || "", cal: r.cal, tone: r.tone || "cream",
    badge: r.badge || null, image: r.image || null,
    available: !!r.available, sort: r.sort,
  };
}
function rowToStore(r) {
  return r ? { id: r.id, name: r.name, address: r.address || "", taxRate: r.tax_rate, username: r.username || null, menu: {} } : null;
}

/* copy the base menu (data.js) into one store, if it has none yet */
function seedStoreCatalog(store, categories, menu) {
  if (cat.countCats.get(store).c === 0) categories.forEach((c, i) => cat.insCat.run(store, c.id, c.label, c.note || null, i));
  if (cat.countProds.get(store).c === 0) {
    menu.forEach((m, i) => cat.insProd.run(store, m.id, m.cat, m.name, m.price, m.desc || null, m.cal ?? null,
      m.tone || "cream", m.badge || null, m.image || null, 1, i));
  }
}

/* seed the initial stores from locations.js (each gets a default login
   username=<id>, password=<id>123) and copy the base menu into each */
function seedStores(locations, baseCategories, baseMenu) {
  if (storeStmt.count.get().c === 0) {
    locations.forEach((l, i) => {
      const creds = auth.hashPassword(l.id + "123");
      storeStmt.ins.run(l.id, l.name, l.address || null, l.taxRate ?? 0.08, l.id, creds.salt, creds.hash, i);
    });
  }
  storeStmt.all.all().forEach((r) => seedStoreCatalog(r.id, baseCategories, baseMenu));
}

/* ---------- stores ---------- */
function listStores() { return storeStmt.all.all().map(rowToStore); }
function getStore(id) { return rowToStore(storeStmt.get.get(id)); }
function defaultStore() { const r = storeStmt.all.all()[0]; return r ? rowToStore(r) : null; }
function findStoreByUsername(u) { return rowToStore(storeStmt.byUser.get(u)); }
function verifyStoreLogin(username, password) {
  const r = storeStmt.byUser.get(username);
  if (!r || !auth.verifyPassword(password, r.pass_salt, r.pass_hash)) return null;
  return rowToStore(r);
}
function createStore(s, baseCategories, baseMenu) {
  const id = slugify(s.id || s.name) || ("store-" + (storeStmt.maxSort.get().m + 1));
  if (storeStmt.get.get(id)) return { error: "a store with that id already exists" };
  if (s.username && storeStmt.byUser.get(s.username)) return { error: "that username is taken" };
  const tax = Number(s.taxRate);
  const creds = s.username && s.password ? auth.hashPassword(s.password) : { salt: null, hash: null };
  storeStmt.ins.run(id, s.name || id, s.address || null, isFinite(tax) ? tax : 0.08,
    s.username || null, creds.salt, creds.hash, storeStmt.maxSort.get().m + 1);
  if (baseCategories && baseMenu) seedStoreCatalog(id, baseCategories, baseMenu); // copy base menu
  return getStore(id);
}
function setStoreCredentials(id, username, password) {
  if (!storeStmt.get.get(id)) return false;
  const other = username && storeStmt.byUser.get(username);
  if (other && other.id !== id) return false; // username taken by another store
  const creds = auth.hashPassword(password);
  storeStmt.setCreds.run(username || null, creds.salt, creds.hash, id);
  return true;
}
function deleteStore(id) {
  cat.delProdsInCat && db.prepare(`DELETE FROM products WHERE store=?`).run(id);
  db.prepare(`DELETE FROM categories WHERE store=?`).run(id);
  return storeStmt.del.run(id).changes > 0;
}

/* ---------- per-store catalog ---------- */
function listCategories(store) {
  return cat.allCats.all(store).map((c) => ({ id: c.id, label: c.label, note: c.note || "" }));
}
function listProducts(store, availableOnly) {
  return (availableOnly ? cat.availProds : cat.allProds).all(store).map(rowToProduct);
}
function createProduct(store, p) {
  const base = p.id && slugify(p.id) ? slugify(p.id) : slugify(p.name) || ("item-" + (cat.maxProdSort.get(store).m + 1));
  let uid = base, n = 2;
  while (cat.getProd.get(store, uid)) uid = base + "-" + n++;
  const sort = cat.maxProdSort.get(store).m + 1;
  cat.insProd.run(store, uid, p.cat, p.name, Number(p.price) || 0, p.desc || null,
    p.cal != null && p.cal !== "" ? parseInt(p.cal, 10) : null,
    p.tone || "cream", p.badge || null, p.image || null, p.available === false ? 0 : 1, sort);
  return rowToProduct(cat.getProd.get(store, uid));
}
function updateProduct(store, id, f) {
  if (!cat.getProd.get(store, id)) return null;
  const cols = { cat: "cat", name: "name", price: "price", desc: "descr", cal: "cal",
                 tone: "tone", badge: "badge", image: "image", available: "available" };
  const sets = [], vals = [];
  for (const [k, col] of Object.entries(cols)) {
    if (!(k in f)) continue;
    let v = f[k];
    if (k === "price") v = Number(v) || 0;
    else if (k === "cal") v = v === "" || v == null ? null : parseInt(v, 10);
    else if (k === "available") v = v ? 1 : 0;
    sets.push(`${col} = ?`); vals.push(v);
  }
  if (sets.length) { vals.push(store, id); db.prepare(`UPDATE products SET ${sets.join(", ")} WHERE store=? AND id=?`).run(...vals); }
  return rowToProduct(cat.getProd.get(store, id));
}
function deleteProduct(store, id) {
  return cat.delProd.run(store, id).changes > 0;
}
function createCategory(store, c) {
  const id = slugify(c.id || c.label) || ("col-" + (cat.maxCatSort.get(store).m + 1));
  if (cat.getCat.get(store, id)) { const r = cat.getCat.get(store, id); return { id: r.id, label: r.label, note: r.note || "" }; }
  cat.insCat.run(store, id, c.label || id, c.note || null, cat.maxCatSort.get(store).m + 1);
  const r = cat.getCat.get(store, id);
  return { id: r.id, label: r.label, note: r.note || "" };
}
function deleteCategory(store, id) {
  cat.delProdsInCat.run(store, id); // cascade: that store's products in this collection
  return cat.delCat.run(store, id).changes > 0;
}

/* ---------- one-time migration from legacy orders.json ---------- */
function migrateLegacyJson(defaultLocation) {
  const haveAny = db.prepare(`SELECT COUNT(*) c FROM orders`).get().c;
  if (haveAny) return 0;
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(LEGACY_JSON, "utf8"));
  } catch {
    return 0; // no legacy file — fresh install
  }
  const orders = Array.isArray(legacy.orders) ? legacy.orders : [];
  for (const o of orders) {
    const loc = o.location || defaultLocation;
    createOrder({
      id: o.id,
      location: loc,
      num: o.num,
      name: o.name || null,
      table: o.table || null,
      type: o.type || "counter",
      items: o.items || [],
      total: o.total || 0,
      status: o.status || "new",
      payment: o.payment || { method: "counter", status: "unpaid", paidAt: null },
      placedAt: o.placedAt || new Date().toISOString(),
      updatedAt: o.updatedAt || new Date().toISOString(),
    });
    // keep numbering ahead of imported orders
    const cur = stmt.getCounter.get(loc);
    if (!cur || cur.next_num <= o.num) stmt.upsertCounter.run(loc, o.num + 1);
  }
  return orders.length;
}

module.exports = {
  DB_FILE,
  nextNum,
  createOrder,
  listOrders,
  getOrder,
  setStatus,
  setPayment,
  getCustomer,
  syncPoints,
  setOrderCustomer,
  migrateLegacyJson,
  // stores
  seedStores,
  listStores,
  getStore,
  defaultStore,
  findStoreByUsername,
  verifyStoreLogin,
  createStore,
  setStoreCredentials,
  deleteStore,
  // per-store catalog
  listCategories,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  createCategory,
  deleteCategory,
};
