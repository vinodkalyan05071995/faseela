# Faseela — QR Table Ordering (realtime, multi-location)

A creative, Faseela sandwich, pastry & dessert ordering system with **QR-code table ordering**,
a **live kitchen display**, and a **billing/cashier station** — all running in real time.

The app is **multi-location ready**: one central server serves every store, and **each store
has its own kitchen screen, its own counter/cashier screen, its own order numbers, tax rate,
menu, and QR codes**. It currently ships configured for a **single store** — adding more is one
entry in `locations.js`, no other code changes.

A guest scans the QR on their table → sees that store's menu → taps **Add** → chooses **Pay now**
or **Pay at counter** → **Place Order**. The order appears instantly on that store's kitchen and
cashier screens, and the guest sees their status update live (Received → Preparing → Ready).

## Files
| File | Purpose |
|------|---------|
| `server.js` | Central realtime server (Node, zero external deps). Serves the site + location-scoped order API + live SSE feed. Prices/tax are authoritative on the server, per location. |
| `locations.js` | **The store registry** — one block per location (id, name, address, tax rate, menu overrides). Add a store here. Shared by server and browser. |
| `db.js` | SQLite store (`node:sqlite`, built-in). Per-location order numbering. Migrates legacy `orders.json` on first run. |
| `data.js` | The **base** menu (items/prices). Per-store tweaks live in `locations.js`. |
| `index.html` + `app.js` + `styles.css` | **Menu / ordering app — the front door (site root).** Reads `?loc=<store>&table=N` from the QR. |
| `home.html` + `home.css` + `home.js` | **Landing page** — marketing story page (secondary). |
| `kds.html` + `kds.js` | **Kitchen display** — locked to one store via `?loc=`, live New → Preparing → Ready board. |
| `cashier.html` + `cashier.js` | **Billing / cashier** — locked to one store, itemized bills, mark paid, printable receipts. |
| `loc-staff.js` | Shared guard for the staff screens — resolves `?loc`, shows a store picker (auto-skipped when there's only one store). |
| `qr-codes.html` | Staff page — generates a printable QR per table, per location. |

## Run it
```bash
cd faseela
node server.js          # needs Node 22.5+ (uses the built-in node:sqlite)
```
Then open (the sample store id is `downtown`):
- **Landing page:** http://localhost:8100/
- **Customer menu (table 7):** http://localhost:8100/index.html?loc=downtown&table=7
- **Counter / order-ahead:** http://localhost:8100/index.html?loc=downtown
- **Kitchen display:** http://localhost:8100/kds.html?loc=downtown
- **Billing / cashier:** http://localhost:8100/cashier.html?loc=downtown
- **Print QR codes:** http://localhost:8100/qr-codes.html

Open the menu and the kitchen/cashier screens side by side to watch orders flow live.
QR codes encode `index.html?loc=<store>&table=N`, so a scan opens the menu locked to that
store **and** that table.

## Adding another location
Add one block to the `LOCATIONS` array in `locations.js`:
```js
{
  id: "lakeside",                       // appears in URLs as ?loc=lakeside
  name: "Faseela Seef",
  address: "8 Harbor Walk · Lake District",
  taxRate: 0.07,                        // this store's tax
  menu: {
    unavailable: ["breakfast-sammie"],  // items this store doesn't carry
    price: { "campfire-mocha": 6.5 },   // this store's price overrides
  },
}
```
That store immediately gets its own kitchen screen (`kds.html?loc=lakeside`), counter screen
(`cashier.html?loc=lakeside`), order-number sequence, tax, menu, and QR codes. When more than
one store exists, the staff screens show a one-time **store picker** (then bookmark the page).

## How it works
- **Per-store isolation:** every order carries a `location`. The kitchen and cashier screens
  subscribe to a location-scoped SSE feed (`/api/stream?loc=…`) and only ever see their own
  store's orders. Order numbers count per store (Downtown #101, Lakeside #101…).
- **Server-authoritative pricing:** the client's prices are ignored. The server rebuilds each
  order from the store's resolved menu and computes the total with that store's tax rate.
- **Who placed it:** table orders are identified by **table number**; counter orders ask for a
  **name**. Both get a big **order number** the guest can quote.
- **Payment:** *Pay now* runs a mock card form (no real charge) and marks the order **Paid**;
  *Pay at counter/table* leaves it **unpaid** for the cashier to settle.
- **Persistence:** orders are stored in SQLite (`orders.db`, survives restart/redeploy). A legacy
  `orders.json`, if present on first boot, is imported into the default store automatically.

### API (for reference / future mobile app)
```
GET  /api/locations                  store registry
GET  /api/menu?loc=ID                resolved menu + tax for a store
GET  /api/stream?loc=ID              SSE live feed (that store only)
GET  /api/orders?loc=ID[&active=1]   list orders for a store
POST /api/orders                     place order  { loc, name, table, type, items[], paymentMethod, paymentStatus }
POST /api/orders/:id/status          advance      { status: new|preparing|ready|completed }
POST /api/orders/:id/payment         settle       { status: paid|unpaid, method: cash|card|online }
```

## Hosting (recommended: one central server)
Run a **single instance in the cloud** that serves every store; each store opens its own
`?loc=` URLs. One deploy updates everyone, and you get central reporting.
- **Easiest:** push the repo to **Render** or **Railway** — they run `node server.js`, give you
  HTTPS, and need no config. (Ensure the Node version is **22.5+** so `node:sqlite` is available.)
- **Also fine:** Fly.io, or a small VPS (DigitalOcean/Hetzner).
- Point the QR page's **Public menu URL** at your domain, pick the location, and print.
- **Trade-off:** central hosting means each store needs working internet; if a store's wifi
  drops, its kitchen screen pauses until it's back. True offline resilience would require a
  per-store server with sync — more complexity than this setup needs.

## Going further later
- **Real card payments:** replace the mock `payForm` in `app.js` with Stripe/Razorpay Checkout,
  and only mark the order paid after the gateway webhook confirms.
- **Per-store staff login:** add lightweight auth so a screen is bound to its store automatically
  instead of via `?loc=`.
- **Postgres:** swap SQLite for Postgres if you later want heavy cross-store reporting.
