/* ============================================================
   FASEELA — landing page interactions
   Renders featured drinks + category tiles from data.js,
   scroll reveals, nav state, mobile menu, newsletter.
   ============================================================ */

(function () {
  "use strict";

  const PLATE = `<svg class="cup-mini" viewBox="0 0 200 200" fill="none"><circle cx="100" cy="100" r="76" fill="rgba(255,255,255,.92)"/><circle cx="100" cy="100" r="34" fill="rgba(0,0,0,.28)"/></svg>`;
  const art = () => PLATE; // food-only menu
  const fmt = (n) => "din " + (Number(n) || 0).toFixed(3);
  const esc = (s) => String(s == null ? "" : s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

  /* ---------- featured drinks + category tiles (from the live catalog) ---------- */
  function renderCatalog(menu, categories) {
    const grid = document.getElementById("drinkGrid");
    if (grid) {
      // badged items (Signature / Fan Fav) make up the spotlight grid
      const picks = menu.filter((m) => m.badge).slice(0, 6);
      grid.innerHTML = picks.map((m) => `
      <a class="drink reveal" href="index.html#${m.cat}">
        <div class="art" style="background:var(--tone-${m.tone})"></div>
        ${art(m.tone)}
        ${m.badge ? `<span class="badge">${esc(m.badge)}</span>` : ""}
        <div class="info">
          <h3>${esc(m.name)}</h3>
          <div class="row"><span class="price">${fmt(m.price)}</span><span class="go">↗</span></div>
        </div>
      </a>`).join("");
    }
    const vibe = document.getElementById("vibeGrid");
    if (vibe) {
      const tones = { sandwiches: "green", pastries: "berry", desserts: "caramel" }; // green / maroon / gold, like the printed menu bands
      vibe.innerHTML = categories.filter((c) => c.id !== "featured").map((c) => `
      <a class="vibe-tile reveal" href="index.html#${c.id}" style="background:var(--tone-${tones[c.id] || "coffee"})">
        <span class="vt">${esc(c.label)}</span>
        <span class="vn">${esc(c.note || "")}</span>
        <span class="arrow">→</span>
      </a>`).join("");
    }
    // these nodes are injected after the reveal observer runs, so show them now
    document.querySelectorAll("#drinkGrid .reveal, #vibeGrid .reveal").forEach((el) => el.classList.add("in"));
  }
  const defLoc = (window.LOC_API && window.LOC_API.DEFAULT_LOCATION) || "downtown";
  fetch("/api/menu?loc=" + encodeURIComponent(defLoc))
    .then((r) => r.json())
    .then((d) => renderCatalog(d.menu || [], d.categories || []))
    .catch(() => renderCatalog(window.MENU || [], window.CATEGORIES || []));

  /* ---------- scroll reveals ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ---------- nav state ---------- */
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("solid", window.scrollY > 30);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---------- mobile menu ---------- */
  const burger = document.getElementById("burger");
  const links = document.getElementById("navLinks");
  burger.addEventListener("click", () => links.classList.toggle("open"));
  links.addEventListener("click", (e) => { if (e.target.tagName === "A") links.classList.remove("open"); });

  /* ---------- subtle parallax (move the whole art block; cup keeps its bob) ---------- */
  const heroArt = document.querySelector(".hero-art");
  if (heroArt && window.matchMedia("(pointer:fine)").matches) {
    window.addEventListener("mousemove", (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 16;
      const y = (e.clientY / window.innerHeight - 0.5) * 16;
      heroArt.style.transform = `translate(${x}px, ${y}px)`;
    });
  }

  /* ---------- newsletter ---------- */
  const toast = document.getElementById("toast");
  let t;
  function showToast(msg) { toast.textContent = msg; toast.classList.add("show"); clearTimeout(t); t = setTimeout(() => toast.classList.remove("show"), 2600); }
  document.getElementById("newsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    e.target.reset();
    showToast("You're in. Welcome to the woods 🌲");
  });
})();
