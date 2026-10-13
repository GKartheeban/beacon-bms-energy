/* =========================================================================
   ui.js - small shared building blocks for the pages (tiles, chips, text).
   All text is set with textContent, never innerHTML, so data stays data.
   ========================================================================= */

(function () {
  function span(text, cls) { const s = document.createElement("span"); if (cls) s.className = cls; s.textContent = text; return s; }
  function chip(text, status) { const c = document.createElement("span"); c.className = "chip " + (status || ""); c.textContent = text; return c; }
  function tile(label, value, unit, sub, cls) {
    const d = document.createElement("div");
    d.className = "tile" + (cls ? " " + cls : "");
    d.innerHTML = `<span class="label"></span><span class="tile-value"><span class="v"></span><small></small></span><span class="tile-sub"></span>`;
    d.querySelector(".label").textContent = label;
    d.querySelector(".v").textContent = value;
    d.querySelector("small").textContent = unit || "";
    const s = d.querySelector(".tile-sub");
    if (typeof sub === "string") s.textContent = sub; else if (sub) s.append(...sub);
    return d;
  }
  const pct = (v) => (v >= 0 ? "+" : "−") + DEMO.kpi.fmt(Math.abs(v * 100), 1) + "%";
  const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const time = (t) => (t ? timeFmt.format(new Date(t)) : "-");

  /* Which building a single-building page shows. With "All buildings" selected,
     the page remembers the last building viewed (default: the first one). */
  function pageBuilding(state) {
    if (state.scope !== "ALL") return state.scope;
    const allowed = DEMO.BUILDINGS.filter((b) => DEMO.auth.canSee(b.id));
    if (!state.pageBuilding || !allowed.some((b) => b.id === state.pageBuilding)) state.pageBuilding = allowed[0].id;
    return state.pageBuilding;
  }

  /* Building tabs, shown on single-building pages when "All buildings" is selected. */
  function buildingTabs(state, onChange) {
    const wrap = document.createElement("div");
    if (state.scope !== "ALL") return wrap;
    wrap.className = "segmented building-tabs";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Choose building");
    const cur = pageBuilding(state);
    for (const b of DEMO.BUILDINGS.filter((x) => DEMO.auth.canSee(x.id))) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = b.name;
      btn.setAttribute("aria-pressed", String(b.id === cur));
      btn.addEventListener("click", () => { state.pageBuilding = b.id; onChange(); });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  DEMO.ui = { span, chip, tile, pct, time, pageBuilding, buildingTabs };
})();
