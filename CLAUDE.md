# Faseela — project rules

A local, realtime QR ordering system for Faseela (sandwiches, pastries, desserts). Static front end + a
zero-dependency Node server. **Think like a senior developer: verify changes in the browser
before claiming done, and keep every page on the shared design system below.**

## Run
`node server.js` → http://localhost:8100 (serves the site + order API + SSE feed).

## Pages & roles
| File | Role | Assets |
|------|------|--------|
| `home.html` | **Landing page** (front door) | `home.css`, `home.js`, `data.js` |
| `index.html` | **Menu / ordering** app (QR target, `?table=N`) | `menu.css`, `app.js`, `data.js` |
| `kds.html` | **Kitchen display** (live board) | inline CSS, `kds.js` |
| `cashier.html` | **Billing / cashier** | inline CSS (uses `styles.css` tokens), `cashier.js` |
| `qr-codes.html` | Printable per-table QR codes | inline CSS (uses `styles.css` tokens) |
| `admin.html` | Product dashboard (store / master login) | inline CSS (uses `styles.css` tokens), `admin.js` |
| `server.js` | Realtime API + static server. Data persists to SQLite (`faseela.db`, or `DB_FILE`). | — |

- QR codes encode `index.html?table=N`. The landing's CTAs link to `index.html`.
- `cashier.html`, `admin.html`, `qr-codes.html`, `kds.html` consume the CSS variables in **`styles.css`**
  (kds also has inline colours). `index.html` uses `menu.css`, `home.html` uses `home.css` — each has
  its own copy of the palette, so keep all three in sync with the tokens below.

## Design system (PARCHMENT — colours taken from the printed Faseela menu)
- **Background:** parchment `#efdcbd`; light surfaces `#f8eedb` / `#fbf4e6`. Grain overlay on the landing.
- **Text:** dark brown `#2e1d14` (primary), `#6f5a46` / `#7d6650` (secondary/muted).
- **Accents:** maroon `#571e24` (primary/CTA, lighter `#7a2e35`), deep green `#23402f` (bands,
  success, paid), gold `#b8914f`. Borders `rgba(87,30,36,.14)`. Text on green/maroon is `#f7ecd6`.
- **Fonts:** **Anton** (poster display / wordmark, UPPERCASE), **Fraunces** (italic serif accents
  & some headings), **Hanken Grotesk** (body). Load Anton via `family=Anton&` in the Google Fonts URL.
- **Buttons:** primary = maroon gradient; secondary = ghost outline. Category tiles: green / maroon / gold.

### Token reference (`styles.css :root`, semantic names kept from the old light theme)
`--parchment` page bg · `--cream` card · `--espresso` text · `--coffee`/`--coffee-soft` secondary ·
`--pine` = maroon (primary) · `--amber`/`--caramel` = deep green · `--gold` · `--rust` = light maroon ·
`--berry` · `--line`. Imagery placeholders use `--tone-*` gradients.

## Conventions / gotchas
- **Text is dark brown on parchment.** If you put a card on a dark green/maroon fill, switch its text
  to `#f7ecd6`, or it becomes unreadable. Use the `--cream` / `--card` parchment surfaces otherwise.
- **Print:** `qr-codes.html` and the cashier receipt force a **white** background + dark text in
  `@media print` — keep that, dark cards waste toner and hide light text.
- **QR boxes stay white** (`#fff`) for scannability — don't theme them dark.
- **Realtime is the source of truth:** UI updates flow from the SSE feed (`/api/stream`), not from
  optimistic local mutations. Place/advance/pay → POST → server broadcasts → screens re-render.
- **Payments are mocked** (no real charge). Real gateway (Stripe/Razorpay) is a later swap; only mark
  paid after a webhook confirms.
- Add real menu photos by setting `image:` on items in `data.js` (gradient placeholder is the fallback).
