/* ============================================================
   FASEELA — Product Dashboard (per-store, with login)
   - Login as a store (edit only your menu) or master (manage
     all stores + edit any store's menu).
   - Catalog changes hit the per-store catalog API and show up
     on that store's customer menu immediately.
   ============================================================ */

(function () {
  "use strict";

  const TKEY = "nw_admin_token";
  let TOKEN = localStorage.getItem(TKEY) || null;
  let ROLE = null;          // "master" | "store"
  let currentStore = null;  // store id being edited
  let products = [];        // last-loaded products (for edit lookup)
  let editingId = null, editingImage = null;

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => "din " + (Number(n) || 0).toFixed(3);
  const esc = (s) => String(s == null ? "" : s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const PLATE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" opacity=".7"/></svg>`;

  let toastTimer;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1900);
  }

  /* ---------- API (authenticated) ---------- */
  async function api(method, path, body) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401) { logoutLocal(); throw new Error("session expired — please log in"); }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
    return res.status === 204 ? null : res.json();
  }
  function withStore(path) {
    if (!currentStore) return path;
    return path + (path.includes("?") ? "&" : "?") + "store=" + encodeURIComponent(currentStore);
  }

  /* ---------- auth ---------- */
  function showLogin() { $("loginScrim").style.display = "grid"; $("dash").hidden = true; $("luser").focus(); }
  function hideLogin() { $("loginScrim").style.display = "none"; $("dash").hidden = false; }
  function logoutLocal() { TOKEN = null; localStorage.removeItem(TKEY); ROLE = null; currentStore = null; showLogin(); }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginErr").textContent = "";
    try {
      const r = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: $("luser").value.trim(), password: $("lpass").value }),
      });
      const data = await r.json();
      if (!r.ok) { $("loginErr").textContent = data.error || "Login failed"; return; }
      TOKEN = data.token; localStorage.setItem(TKEY, TOKEN);
      $("lpass").value = "";
      hideLogin();
      await applyRole(data.role, data.store);
    } catch (err) { $("loginErr").textContent = "Couldn't reach the server"; }
  });

  $("logoutBtn").addEventListener("click", async () => {
    try { await api("POST", "/api/logout"); } catch {}
    logoutLocal();
  });

  async function applyRole(role, store) {
    ROLE = role;
    if (role === "master") {
      $("who").textContent = "Master admin";
      $("dashSub").textContent = "All stores";
      $("storesPanel").hidden = false;
      $("storeSwitch").hidden = false;
      await loadStores();
    } else {
      $("who").textContent = store ? store.name : "Store";
      $("dashSub").textContent = store ? store.name : "Your store";
      $("storesPanel").hidden = true;
      $("storeSwitch").hidden = true;
      currentStore = store ? store.id : null;
    }
    updateViewMenuLink();
    await reload();
  }

  function updateViewMenuLink() {
    const a = $("viewMenuLink");
    if (currentStore) a.href = "index.html?loc=" + encodeURIComponent(currentStore) + "&table=7";
  }

  /* ---------- master: stores ---------- */
  async function loadStores() {
    const stores = await api("GET", "/api/stores");
    const sw = $("storeSwitch");
    sw.innerHTML = stores.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    if (!currentStore || !stores.find((s) => s.id === currentStore)) currentStore = stores[0] ? stores[0].id : null;
    sw.value = currentStore;
    renderStores(stores);
  }
  function renderStores(stores) {
    $("storesList").innerHTML = stores.map((s) => `
      <div class="store-row" data-store="${esc(s.id)}">
        <div>
          <div class="sname">${esc(s.name)} <span class="smeta">· ${esc(s.id)} · login: ${esc(s.username || "—")}</span></div>
          <div class="smeta">${esc(s.address || "")}</div>
        </div>
        <span class="stax">${(s.taxRate * 100).toFixed(s.taxRate * 100 % 1 ? 3 : 0)}% tax</span>
        <button class="sdel" data-delstore="${esc(s.id)}" title="Delete store">✕</button>
      </div>`).join("");
  }
  $("storeSwitch").addEventListener("change", async (e) => {
    currentStore = e.target.value; updateViewMenuLink();
    try { await reload(); } catch (err) { toast(err.message); }
  });
  $("storeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      name: $("sName").value.trim(), address: $("sAddr").value.trim() || null,
      taxRate: $("sTax").value !== "" ? Number($("sTax").value) / 100 : 0.08,
      username: $("sUser").value.trim(), password: $("sPass").value,
    };
    if (!body.name || !body.username || !body.password) { toast("Name, username and password are required"); return; }
    try {
      const s = await api("POST", "/api/stores", body);
      e.target.reset();
      toast(s.name + " added (menu copied from base)");
      currentStore = s.id;
      await loadStores(); updateViewMenuLink(); await reload();
    } catch (err) { toast("Add store failed: " + err.message); }
  });
  $("storesList").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-delstore]");
    if (!del) return;
    if (!confirm("Delete this store and its entire menu? This can't be undone.")) return;
    try {
      await api("DELETE", "/api/stores/" + del.dataset.delstore);
      toast("Store deleted");
      if (currentStore === del.dataset.delstore) currentStore = null;
      await loadStores(); updateViewMenuLink(); await reload();
    } catch (err) { toast("Delete failed: " + err.message); }
  });

  /* ---------- catalog render ---------- */
  function thumb(p) {
    if (p.image) return `<div class="pthumb" style="background-image:url('${esc(p.image)}')"></div>`;
    return `<div class="pthumb" style="background:var(--tone-${esc(p.tone || "cream")})">${PLATE}</div>`;
  }
  function productRow(p) {
    return `<div class="prow" data-id="${esc(p.id)}">
      ${thumb(p)}
      <div class="pinfo">
        <h4>${esc(p.name)} ${p.badge ? `<span class="pbadge">${esc(p.badge)}</span>` : ""}</h4>
        ${p.desc ? `<div class="pdesc">${esc(p.desc)}</div>` : ""}
      </div>
      <span class="pprice">${fmt(p.price)}</span>
      <button class="pedit" data-edit="${esc(p.id)}">Edit</button>
      <button class="ptog ${p.available ? "" : "off"}" data-toggle="${esc(p.id)}" data-avail="${p.available ? 1 : 0}">${p.available ? "Visible" : "Hidden"}</button>
      <button class="pdel" data-del="${esc(p.id)}" title="Delete">✕</button>
    </div>`;
  }
  function render(catalog) {
    const { categories } = catalog;
    products = catalog.products;
    $("pCat").innerHTML = categories.map((c) => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join("");
    $("catalog").innerHTML = categories.map((c) => {
      const items = products.filter((p) => p.cat === c.id);
      const rows = items.length ? items.map(productRow).join("") : `<div class="empty">No products yet — add one on the left.</div>`;
      return `<div class="col-sec" data-cat="${esc(c.id)}">
        <div class="col-head">
          <h3>${esc(c.label)}</h3>
          <span class="cnt">${items.length}</span>
          ${c.note ? `<span class="note">${esc(c.note)}</span>` : ""}
          <button class="delcol" data-delcol="${esc(c.id)}">Delete collection</button>
        </div>${rows}
      </div>`;
    }).join("") || `<div class="col-sec"><div class="empty">No collections yet — add one above.</div></div>`;
  }
  async function reload() {
    if (!currentStore) { $("catalog").innerHTML = ""; return; }
    try { render(await api("GET", withStore("/api/catalog"))); }
    catch (e) { toast("Couldn't load catalog: " + e.message); }
  }

  /* ---------- image: preview + upload ---------- */
  const fileInput = $("pImgFile"), filePrev = $("pImgPrev");
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) { filePrev.src = URL.createObjectURL(f); filePrev.style.display = "block"; } else filePrev.style.display = "none";
  });
  function readDataUrl(file) {
    return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error("could not read file")); r.readAsDataURL(file); });
  }
  async function resolveImage() {
    const f = fileInput.files && fileInput.files[0];
    if (f) {
      if (f.size > 4 * 1024 * 1024) throw new Error("image too large (max 4MB)");
      const out = await api("POST", "/api/upload", { filename: f.name, dataUrl: await readDataUrl(f) });
      return out.path;
    }
    const url = $("pImg").value.trim();
    if (url) return url;
    return editingId ? editingImage : null;
  }

  /* ---------- edit mode ---------- */
  function startEdit(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    editingId = id; editingImage = p.image || null;
    $("pName").value = p.name; $("pCat").value = p.cat; $("pPrice").value = p.price;
    $("pCal").value = p.cal != null ? p.cal : ""; $("pBadge").value = p.badge || "";
    $("pTone").value = p.tone || "cream"; $("pImg").value = ""; $("pDesc").value = p.desc || "";
    $("pAvail").checked = p.available; fileInput.value = "";
    if (p.image) { filePrev.src = p.image; filePrev.style.display = "block"; } else filePrev.style.display = "none";
    $("prodFormTitle").textContent = "Edit product"; $("prodSubmit").textContent = "Save changes"; $("prodCancel").hidden = false;
    document.querySelectorAll(".prow.editing").forEach((r) => r.classList.remove("editing"));
    const row = $("catalog").querySelector(`.prow[data-id="${(window.CSS && CSS.escape) ? CSS.escape(id) : id}"]`);
    if (row) row.classList.add("editing");
    $("prodForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function cancelEdit() {
    editingId = null; editingImage = null;
    $("prodForm").reset(); $("pAvail").checked = true; filePrev.style.display = "none";
    $("prodFormTitle").textContent = "Add product"; $("prodSubmit").textContent = "+ Add product"; $("prodCancel").hidden = true;
    document.querySelectorAll(".prow.editing").forEach((r) => r.classList.remove("editing"));
  }
  $("prodCancel").addEventListener("click", cancelEdit);

  /* ---------- add / save product ---------- */
  $("prodForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("pName").value.trim(), cat = $("pCat").value;
    if (!name || !cat) { toast("Name and collection are required"); return; }
    const btn = $("prodSubmit"); btn.disabled = true;
    try {
      const image = await resolveImage();
      const payload = {
        name, cat, price: $("pPrice").value, cal: $("pCal").value,
        badge: $("pBadge").value.trim() || null, tone: $("pTone").value,
        image, desc: $("pDesc").value.trim() || null, available: $("pAvail").checked,
      };
      const wasEdit = !!editingId;
      if (wasEdit) await api("PATCH", withStore("/api/products/" + editingId), payload);
      else await api("POST", withStore("/api/products"), payload);
      cancelEdit(); toast(name + (wasEdit ? " updated" : " added")); reload();
    } catch (err) { toast((editingId ? "Save" : "Add") + " failed: " + err.message); }
    finally { btn.disabled = false; }
  });

  /* ---------- add collection ---------- */
  $("colForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = $("cLabel").value.trim();
    if (!label) return;
    try {
      await api("POST", withStore("/api/collections"), { label, note: $("cNote").value.trim() || null });
      e.target.reset(); toast("Collection “" + label + "” added"); reload();
    } catch (err) { toast("Add failed: " + err.message); }
  });

  /* ---------- catalog delegated actions ---------- */
  $("catalog").addEventListener("click", async (e) => {
    const edit = e.target.closest("[data-edit]");
    const tog = e.target.closest("[data-toggle]");
    const del = e.target.closest("[data-del]");
    const delcol = e.target.closest("[data-delcol]");
    if (edit) { startEdit(edit.dataset.edit); return; }
    try {
      if (tog) { await api("PATCH", withStore("/api/products/" + tog.dataset.toggle), { available: tog.dataset.avail !== "1" }); reload(); }
      else if (del) {
        const row = del.closest(".prow");
        if (!confirm("Delete " + (row ? row.querySelector("h4").textContent.trim() : "this product") + "?")) return;
        await api("DELETE", withStore("/api/products/" + del.dataset.del)); toast("Product deleted"); reload();
      } else if (delcol) {
        if (!confirm("Delete this collection AND all its products?")) return;
        await api("DELETE", withStore("/api/collections/" + delcol.dataset.delcol)); toast("Collection deleted"); reload();
      }
    } catch (err) { toast("Action failed: " + err.message); }
  });

  /* ---------- boot: restore session or show login ---------- */
  (async function init() {
    if (!TOKEN) { showLogin(); return; }
    try {
      const me = await fetch("/api/me", { headers: { Authorization: "Bearer " + TOKEN } });
      if (!me.ok) { logoutLocal(); return; }
      const data = await me.json();
      hideLogin();
      await applyRole(data.role, data.store);
    } catch { logoutLocal(); }
  })();
})();
