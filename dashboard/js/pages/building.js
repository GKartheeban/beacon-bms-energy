/* =========================================================================
   Page 2 - Building View
   One building: headline figures, today's load profile, energy by system,
   and a card per system. Cards open System Detail.
   ========================================================================= */

(function () {
  const fmt = (v, d) => DEMO.kpi.fmt(v, d);
  const K = () => DEMO.kpi;
  const U = () => DEMO.ui;

  function render(el, state) {
    const bid = U().pageBuilding(state);
    const b = DEMO.BUILDINGS.find((x) => x.id === bid);
    el.innerHTML = `
      <div class="page-head">
        <div><h1 id="bv-name"></h1><p id="bv-sub"></p></div>
        <div class="head-right" id="bv-tabs"></div>
      </div>
      <div class="banner" id="bv-banner" role="status" hidden></div>
      <section class="tiles" id="bv-tiles" aria-label="Headline figures"></section>
      <section class="split">
        <div class="card">
          <div class="card-head"><h2 id="bv-chart-title"></h2></div>
          <div class="chart" id="chart-load" role="img" aria-label="Load profile for today"></div>
          <p class="chart-note" id="bv-chart-note"></p>
        </div>
        <div class="card">
          <div class="card-head"><h2 id="bv-side-title"></h2></div>
          <div id="bv-side"></div>
        </div>
      </section>
      <section>
        <div class="section-head"><h2>Systems</h2><p class="muted" id="bv-sys-note"></p></div>
        <div class="sys-grid" id="bv-systems"></div>
      </section>`;
    el.querySelector("#bv-name").textContent = b.name;
    el.querySelector("#bv-sub").textContent = `${b.type} · ${b.city} · ${fmt(b.areaM2)} m² · ${b.floors} floors · ${b.hoursText}`;
    el.querySelector("#bv-tabs").appendChild(U().buildingTabs(state, () => render(el, state)));
    update(el, state);
  }

  function update(el, state) {
    if (!el.querySelector("#bv-tiles")) return;
    const sim = state.sim, raw = state.mode === "raw";
    const bid = U().pageBuilding(state);
    const b = DEMO.BUILDINGS.find((x) => x.id === bid);
    const st = sim.state[bid], l = st.last;
    const t = K().totals(sim, bid);
    const { tile, chip, span, pct } = U();

    /* gateway banner (KPI view explains it; raw view just shows stale values) */
    const banner = el.querySelector("#bv-banner");
    if (st.offline && !raw) {
      banner.hidden = false;
      banner.textContent = `Gateway offline since ${U().time(st.offlineSince)}. Figures show the last readings received. Missing readings will be filled in when the gateway reconnects.`;
    } else banner.hidden = true;

    /* tiles */
    const tiles = el.querySelector("#bv-tiles");
    tiles.innerHTML = "";
    if (raw) {
      tiles.append(
        tile("Main incomer", fmt(l.grid + l.dg), "kW", st.offline ? "COMM FAIL" : `Reading ${U().time(st.lastTs)}`),
        tile("Energy register", fmt(st.meter), "kWh", "Cumulative meter total"),
        tile("Power factor", fmt(l.pf, 2), "", "Main incomer"),
        tile("Max demand today", fmt(st.maxKva), "kVA", "Since 00:00"),
        tile("Solar inverter", fmt(l.solar), "kW", `${fmt(b.solarKWp)} kWp installed`),
        tile("Outdoor temperature", fmt(l.tout, 1), "°C", "Weather sensor")
      );
    } else {
      tiles.append(
        tile("Live load", fmt(t.kw), "kW", [chip(t.overBaseline > 0.05 ? "Above baseline" : "On baseline", t.overBaseline > 0.05 ? "warning" : "good"), span(`${pct(t.overBaseline)} vs efficient`)]),
        tile("Energy today", fmt(t.kwh), "kWh", [span(pct(t.vsYesterday), t.vsYesterday > 0 ? "delta-up" : "delta-down"), span("vs yesterday at this time")]),
        tile("Cost today", K().inr(t.cost), "", `${fmt(st.solarKwh)} kWh from solar today`),
        tile("Energy intensity (EUI)", fmt(t.eui), "kWh/m²·yr", "7-day average, annualised"),
        tile("Open faults", fmt(t.faultsOpen), "", [chip(t.faultsCritical ? `${t.faultsCritical} critical` : t.faultsOpen ? "Warnings only" : "All clear", t.faultsCritical ? "critical" : t.faultsOpen ? "warning" : "good")]),
        tile("Savings found", K().inr(t.wasteMonth, true), "/ month", `${K().inr(t.wasteToday)} wasted so far today`, "accent")
      );
    }

    /* load chart */
    el.querySelector("#bv-chart-title").textContent = raw ? "Main incomer, today (kW)" : "Load profile today, by system (kW)";
    el.querySelector("#bv-chart-note").textContent = raw
      ? "Trend of the main electricity meter, one reading every 15 minutes."
      : "Coloured bands: energy use by system. Dashed line: efficient baseline. Dotted line: yesterday. Gaps mean readings have not arrived yet.";
    DEMO.charts.load(K().series(sim, bid), state.mode, K().curSlot(sim));

    /* side: energy by system (KPI) or sub-meter readings (raw) */
    const side = el.querySelector("#bv-side");
    const rows = K().systemKwh(sim, bid);
    if (raw) {
      el.querySelector("#bv-side-title").textContent = "Sub-meter readings";
      DEMO.charts.dispose("chart-systems");
      side.innerHTML = `<div class="table-wrap"><table class="data compact"><thead><tr><th>Meter</th><th class="n">kW</th><th class="n">Register kWh</th></tr></thead><tbody></tbody></table></div>`;
      const tb = side.querySelector("tbody");
      rows.forEach((r, i) => {
        const tr = tb.insertRow(); tr.className = "static";
        const c0 = tr.insertCell(); c0.textContent = `EM-${String(i + 1).padStart(2, "0")} ${r.name}`;
        const c1 = tr.insertCell(); c1.className = "n"; c1.textContent = fmt(r.kw, 1);
        const c2 = tr.insertCell(); c2.className = "n"; c2.textContent = fmt(1000000 + i * 731447 % 900000 + st.kwh[r.id] + (b.meterStart % 1000) * (i + 3));
      });
    } else {
      el.querySelector("#bv-side-title").textContent = "Energy today by system";
      if (!side.querySelector("#chart-systems")) side.innerHTML = `<div class="chart chart-tall" id="chart-systems" role="img" aria-label="Energy today by system, ranked"></div>`;
      DEMO.charts.systems(rows);
    }

    /* system cards */
    el.querySelector("#bv-sys-note").textContent = raw ? "Live readings from each system." : "Each system's key KPI against its target. Open a card for equipment details.";
    const grid = el.querySelector("#bv-systems");
    grid.innerHTML = "";
    for (const c of K().systemCards(sim, bid)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "sys-card" + (!raw && (c.kpi.status === "critical" || c.kpi.status === "warning") ? " is-" + c.kpi.status : "");
      const head = document.createElement("div"); head.className = "sys-head";
      head.append(span(c.name, "sys-name"), span(c.kw != null ? `${fmt(c.kw, c.kw < 10 ? 1 : 0)} kW` : "", "sys-kw num"));
      card.appendChild(head);
      if (raw) {
        const dl = document.createElement("dl"); dl.className = "kv";
        for (const [k, v] of c.raw) { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); }
        card.appendChild(dl);
      } else {
        const k = c.kpi;
        const lab = span(k.label, "label");
        const val = document.createElement("div"); val.className = "sys-value";
        val.append(span(k.value, ""), span(k.unit, "unit"));
        const tgt = span(k.target, "sys-target");
        const foot = document.createElement("div"); foot.className = "sys-foot";
        const statusText = { good: "On target", warning: "Needs attention", critical: "Action needed", info: "For information" }[k.status];
        foot.append(chip(statusText, k.status), span(k.insight, "sys-insight"));
        card.append(lab, val, tgt, foot);
      }
      card.addEventListener("click", () => { state.pageBuilding = bid; location.hash = "system/" + c.id; });
      grid.appendChild(card);
    }
  }

  DEMO.pages = DEMO.pages || {};
  DEMO.pages.building = { render, update };
})();
