/* =========================================================================
   Page 1 - Portfolio Overview
   Raw view: meter readings as the BMS shows them.
   KPI view: the same readings as cost, efficiency, faults and savings.
   ========================================================================= */

(function () {
  const K = () => DEMO.kpi;
  const fmt = (v, d) => DEMO.kpi.fmt(v, d);
  const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

  function visibleScope(state) { return state.scope; }

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
  function chip(text, status) { const c = document.createElement("span"); c.className = "chip " + status; c.textContent = text; return c; }
  function span(text, cls) { const s = document.createElement("span"); if (cls) s.className = cls; s.textContent = text; return s; }
  function pct(v) { return (v >= 0 ? "+" : "−") + fmt(Math.abs(v * 100), 1) + "%"; }

  function render(el, state) {
    el.innerHTML = `
      <div class="page-head">
        <div><h1>Portfolio Overview</h1><p id="ov-sub"></p></div>
        <p class="mode-note" id="ov-note"></p>
      </div>
      <section class="tiles" id="ov-tiles" aria-label="Headline figures"></section>
      <section class="split">
        <div class="card">
          <div class="card-head"><div><h2 id="ov-chart-title"></h2></div></div>
          <div class="chart" id="chart-load" role="img" aria-label="Load profile for today"></div>
          <p class="chart-note" id="ov-chart-note"></p>
        </div>
        <div class="card" id="ov-side-card">
          <div class="card-head"><h2 id="ov-side-title"></h2><button class="link-btn" id="ov-side-link" type="button"></button></div>
          <div id="ov-side"></div>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Buildings</h2><p>Click a building to open its Building View.</p></div></div>
        <div class="table-wrap"><table class="data" id="ov-table"><thead></thead><tbody></tbody></table></div>
      </section>`;
    el.querySelector("#ov-side-link").addEventListener("click", () => {
      location.hash = state.mode === "kpi" ? "insights" : "faults";
    });
    update(el, state);
  }

  function update(el, state) {
    if (!el.querySelector("#ov-tiles")) return;
    const sim = state.sim, scope = visibleScope(state), raw = state.mode === "raw";
    const t = K().totals(sim, scope);
    const bs = K().buildingsIn(scope);
    const hour = sim.t ? new Date(sim.t).getHours() : 12;

    el.querySelector("#ov-sub").textContent = scope === "ALL"
      ? `${bs.length} buildings · ${fmt(t.area)} m² · live readings every 15 minutes`
      : `${bs[0].name} · ${bs[0].type}, ${bs[0].city} · ${fmt(t.area)} m²`;
    el.querySelector("#ov-note").textContent = raw
      ? "Raw data: readings exactly as the BMS reports them."
      : "KPI view: the same readings turned into cost, efficiency and savings.";

    /* ---- tiles ---- */
    const tiles = el.querySelector("#ov-tiles");
    tiles.innerHTML = "";
    if (raw) {
      tiles.append(
        tile("Main incomer", fmt(t.gridKw + t.dgKw), "kW", "Live reading"),
        tile("Energy register", fmt(t.meter), "kWh", "Cumulative meter total"),
        tile("Power factor", fmt(t.pf, 2), "", "Main incomer"),
        tile("Max demand today", fmt(t.maxKva), "kVA", "Since 00:00"),
        tile("Active alarms", fmt(t.faultsOpen), "", "See Faults & Alerts"),
        tile("Outdoor temperature", fmt(t.tout, 1), "°C", "Weather sensor")
      );
    } else {
      const over = t.overBaseline;
      const tariff = DEMO.tariffAt(hour);
      const band = tariff === DEMO.TARIFF.peak ? "peak" : tariff === DEMO.TARIFF.offPeak ? "off-peak" : "normal";
      tiles.append(
        tile("Live load", fmt(t.kw), "kW", [chip(over > 0.05 ? "Above baseline" : "On baseline", over > 0.05 ? "warning" : "good"), span(`${pct(over)} vs efficient`)]),
        tile("Energy today", fmt(t.kwh), "kWh", [span(pct(t.vsYesterday), t.vsYesterday > 0 ? "delta-up" : "delta-down"), span("vs yesterday at this time")]),
        tile("Cost today", K().inr(t.cost), "", `Tariff now ₹${tariff.toFixed(2)}/kWh (${band})`),
        tile("Energy intensity (EUI)", fmt(t.eui), "kWh/m²·yr", "7-day average, annualised"),
        tile("Open faults", fmt(t.faultsOpen), "", [chip(t.faultsCritical ? `${t.faultsCritical} critical` : t.faultsOpen ? "Warnings only" : "All clear", t.faultsCritical ? "critical" : t.faultsOpen ? "warning" : "good")]),
        tile("Savings found", K().inr(t.wasteMonth, true), "/ month", `${K().inr(t.wasteToday)} wasted so far today`, "accent")
      );
    }

    /* ---- chart ---- */
    el.querySelector("#ov-chart-title").textContent = raw ? "Main incomer, today (kW)" : "Load profile today, by system (kW)";
    el.querySelector("#ov-chart-note").textContent = raw
      ? "Trend of the main electricity meter, one reading every 15 minutes."
      : "Coloured bands: energy use by system. Dashed line: efficient baseline (the same day without the waste found). Dotted line: yesterday.";
    DEMO.charts.load(K().series(sim, scope), state.mode, K().curSlot(sim));

    /* ---- side card ---- */
    const side = el.querySelector("#ov-side");
    side.innerHTML = "";
    if (raw) {
      el.querySelector("#ov-side-title").textContent = "BMS event log";
      el.querySelector("#ov-side-link").textContent = "Open alarms";
      const log = document.createElement("div"); log.className = "log";
      for (const e of sim.rawLog.filter((x) => bs.some((b) => b.id === x.building)).slice(0, 9)) {
        const row = document.createElement("div");
        row.append(span(timeFmt.format(new Date(e.t))), span(e.building), span(e.text));
        log.appendChild(row);
      }
      side.appendChild(log);
    } else {
      el.querySelector("#ov-side-title").textContent = "Top savings found";
      el.querySelector("#ov-side-link").textContent = "All insights";
      const list = document.createElement("div"); list.className = "list";
      for (const f of K().findings(sim, scope).slice(0, 4)) {
        const item = document.createElement("div"); item.className = "list-item";
        const r1 = document.createElement("div"); r1.className = "list-row";
        r1.append(span(f.title, "title"), span(K().inr(f.costMonth, true) + "/mo", "money"));
        const r2 = document.createElement("div"); r2.className = "list-row";
        r2.append(span(`${f.building.name} · ${DEMO.SYSTEMS.find((s) => s.id === f.system).name}`, "meta"),
                  chip(f.activeNow ? "Happening now" : "Recurring", f.activeNow ? "critical" : "warning"));
        item.append(r1, r2);
        list.appendChild(item);
      }
      side.appendChild(list);
    }

    /* ---- buildings table ---- */
    const table = el.querySelector("#ov-table");
    const head = raw
      ? [["Building"], ["Gateway"], ["Last reading"], ["Main incomer kW", "n"], ["Energy register kWh", "n"], ["Power factor", "n"], ["Alarms", "n"]]
      : [["Building"], ["Live load kW", "n"], ["Energy today kWh", "n"], ["EUI kWh/m²·yr", "n"], ["Cost today", "n"], ["Savings found / mo", "n"], ["Faults", "n"], ["Status"]];
    const thead = table.tHead; thead.innerHTML = "";
    const hr = thead.insertRow();
    for (const [h, c] of head) { const th = document.createElement("th"); th.textContent = h; if (c) th.className = c; hr.appendChild(th); }
    const tbody = table.tBodies[0]; tbody.innerHTML = "";
    for (const b of DEMO.BUILDINGS.filter((x) => DEMO.auth.canSee(x.id))) {
      const bt = K().totals(sim, b.id);
      const st = sim.state[b.id];
      const tr = tbody.insertRow();
      if (scope === b.id) tr.className = "is-selected";
      const nameCell = tr.insertCell();
      nameCell.append(span(b.name, "bname"), document.createElement("br"), span(`${b.type} · ${b.city} · ${fmt(b.areaM2)} m²`, "bsub"));
      const cell = (v, cls) => { const c = tr.insertCell(); if (cls) c.className = cls; if (v instanceof Node) c.append(v); else c.textContent = v; };
      if (raw) {
        cell(st.offline ? span("OFFLINE", "stale") : "ONLINE");
        cell(st.lastTs ? timeFmt.format(new Date(st.lastTs)) : "-");
        cell(fmt(st.last.grid + st.last.dg), "n");
        cell(fmt(st.meter), "n");
        cell(fmt(st.last.pf, 2), "n");
        cell(fmt(bt.faultsOpen), "n");
      } else {
        const status = st.offline ? ["Data gap", "critical"] : bt.faultsCritical ? ["Critical fault", "critical"] : bt.wasteMonth > 50000 ? ["Needs attention", "warning"] : ["On track", "good"];
        cell(fmt(bt.kw), "n");
        cell(fmt(bt.kwh), "n");
        cell(fmt(bt.eui), "n");
        cell(K().inr(bt.cost), "n");
        cell(K().inr(bt.wasteMonth, true), "n");
        cell(fmt(bt.faultsOpen), "n");
        cell(chip(status[0], status[1]));
      }
      tr.tabIndex = 0;
      const open = () => {
        state.scope = b.id;
        const sel = document.getElementById("scope"); if (sel) sel.value = b.id;
        try { sessionStorage.setItem("eh-scope", b.id); } catch (e) {}
        location.hash = "building";
      };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    }
  }

  DEMO.pages = DEMO.pages || {};
  DEMO.pages.overview = { render, update };
})();
