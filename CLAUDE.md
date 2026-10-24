# Faseela — project rules

A local, realtime QR ordering system for Faseela (sandwiches, pastries, desserts). Static front end + a
zero-dependency Node server. **Think like a senior developer: verify changes in the browser
before claiming done, and keep every page on the shared design system below.**

## Run
`node server.js` → http://localhost:8100 (serves the site + order API + SSE feed).

## Pages & roles
| File | Role | Assets |
|------|------|--------|
| `index.html` | **Landing page** (front door) | `home.css`, `home.js`, `data.js` |
| `index.html` | **Menu / ordering** app (QR target, `?table=N`) | `styles.css`, `app.js`, `data.js` |
| `kds.html` | **Kitchen display** (live board) | inline CSS, `kds.js` |
| `cashier.html` | **Billing / cashier** | inline CSS (uses `styles.css` tokens), `cashier.js` |
| `qr-codes.html` | Printable per-table QR codes | inline CSS (uses `styles.css` tokens) |
| `server.js` | Realtime API + static server. Orders persist to `orders.json`. | — |

- QR codes encode `index.html?table=N`. The landing's CTAs link to `index.html`.
- `index.html`, `cashier.html`, `qr-codes.html` all consume the CSS variables in **`styles.css`**,
  so changing those tokens reskins three pages at once. `index.html` uses `home.css`; `kds.html`
  has its own inline palette — keep both in sync with the tokens below.

## Design system (DARK-NEON — every page follows this)
- **Background:** near-black espresso `#0c0805`, with soft ember + teal radial glows. Grain overlay.
- **Surfaces (cards):** `#1a130c`–`#211a12`, 1px border `rgba(245,236,219,0.12)`.
- **Text:** cream `#f5ecdb` (primary), `#cdbca6` / `#b6a48d` (secondary/muted).
- **Accents:** ember `#ff7a1a` (primary/CTA), teal `#18e3cb`–`#54f0dd`, gold `#ffd27a`,
  coral `#ff5a3c`, neon berry `#ff4d8d`. Paid/success stays green `#1f9d63`.
- **Fonts:** **Anton** (poster display / wordmark, UPPERCASE), **Fraunces** (italic serif accents
  & some headings), **Hanken Grotesk** (body). Load Anton via `family=Anton&` in the Google Fonts URL.
- **Buttons:** primary = ember gradient with glow; secondary = ghost outline that turns teal on hover.

### Token reference (`styles.css :root`, semantic names kept from the old light theme)
`--parchment` page bg · `--cream` card · `--espresso` text · `--coffee`/`--coffee-soft` secondary ·
`--pine` = ember (primary) · `--amber`/`--caramel` = teal · `--gold` · `--rust` = coral CTA ·
`--berry` · `--line`. Imagery placeholders use `--tone-*` gradients.

## Conventions / gotchas
- **Never put a hardcoded light background on a card** — text color is light (`--espresso`), so a
  light surface makes text invisible (this bit the KDS cards once). Use the dark `--cream` surface.
- **Print:** `qr-codes.html` and the cashier receipt force a **white** background + dark text in
  `@media print` — keep that, dark cards waste toner and hide light text.
- **QR boxes stay white** (`#fff`) for scannability — don't theme them dark.
- **Realtime is the source of truth:** UI updates flow from the SSE feed (`/api/stream`), not from
  optimistic local mutations. Place/advance/pay → POST → server broadcasts → screens re-render.
- **Payments are mocked** (no real charge). Real gateway (Stripe/Razorpay) is a later swap; only mark
  paid after a webhook confirms.
- Add real menu photos by setting `image:` on items in `data.js` (gradient placeholder is the fallback).
