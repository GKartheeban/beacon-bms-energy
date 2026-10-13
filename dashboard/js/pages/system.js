/* =========================================================================
   Page 3 - System Detail
   One system in one building: KPI against target, today's trend,
   equipment readings, findings and faults.
   ========================================================================= */

(function () {
  const fmt = (v, d) => DEMO.kpi.fmt(v, d);
  const K = () => DEMO.kpi;
  const U = () => DEMO.ui;

  /* What each KPI means, in plain words. */
  const EXPLAIN = {
    chiller: "kW/TR is the electrical power of the whole plant (chillers, pumps and cooling towers) for each ton of cooling delivered. Lower is better; a well-run plant works at about 0.6-0.7 kW/TR. A low chilled water ΔT means pumps move more water than needed.",
    airside: "Energy used by air handling units and fan coils outside occupied hours, or in empty and unsold rooms. In a well-run building this is close to zero.",
    lighting: "Lighting energy used outside the schedule or in areas with no occupancy. Lighting power density compares the lighting load with the floor area.",
    vent: "Exhaust and car park fans should slow down when CO / CO₂ levels are low. Running them harder than needed is avoidable energy.",
    vertical: "Elevators and escalators should switch to standby or slow mode when nobody is using them, especially outside opening hours.",
    hotwater: "Hot water must be stored at about 60 °C to prevent Legionella. Storing it hotter than that only adds standby heat loss. Never go below 60 °C.",
    water: "Specific pumping energy is the kWh needed to pump one m³ of water. A rising value points to worn pumps or pressure set higher than needed.",
    cold: "Door-open time is the biggest cause of wasted energy in cold rooms. Temperatures must stay within the food-safe range.",
    ups: "UPS efficiency is output power divided by input power. Efficiency drops sharply when a UPS runs at low load; the difference is lost as heat that the AC must remove.",
    plants: "In the STP, dissolved oxygen above target means the aeration blowers, the plant's largest load, are working harder than needed.",
    kitchen: "Kitchen, laundry and pool energy is tracked per meal served, per kg of linen and per day once operations data is connected.",
    plug: "Power drawn at 3 AM, when the building is mostly empty, shows equipment left switched on overnight.",
    iaq: "Comfort compliance is the share of time CO₂, temperature and humidity stay within the agreed limits. It shows whether energy savings are affecting comfort.",
    supply: "Share of today's energy supplied by on-site solar, and how long the diesel generator ran. Diesel power costs about three times as much as grid power."
  };
  const EVENT_SYSTEM = { airside: "airside", iaq: "iaq", power: "supply", comms: null };

  function render(el, state) {
    const bid = U().pageBuilding(state);
    const sysId = state.param || "chiller";
    const b = DEMO.BUILDINGS.find((x) => x.id === bid);
    el.innerHTML = `
      <a class="back-link" href="#building">← Back to ${b.name}</a>
      <div class="page-head">
        <div><h1 id="sd-name"></h1><p id="sd-sub"></p></div>
        <div class="head-right">
          <div id="sd-tabs"></div>
          <label class="sr-only" for="sd-system">System</label>
          <select class="select select-sm" id="sd-system"></select>
        </div>
      </div>
      <section class="split">
        <div class="card" id="sd-kpi-card"></div>
        <div class="card">
          <div class="card-head"><h2 id="sd-figs-title"></h2></div>
          <dl class="kv kv-lg" id="sd-figs"></dl>
        </div>
      </section>
      <section class="split">
        <div class="card">
          <div class="card-head"><h2>Today (kW)</h2><p id="sd-trend-note"></p></div>
          <div class="chart" id="chart-trend" role="img" aria-label="Power used by this system today"></div>
        </div>
        <div class="card" id="sd-findings-card">
          <div class="card-head"><h2 id="sd-find-title"></h2></div>
          <div id="sd-findings"></div>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Equipment</h2><p>Live readings from each piece of equipment.</p></div></div>
        <div class="table-wrap"><table class="data" id="sd-equip"><thead><tr><th>Equipment</th><th>Status</th><th class="n">Reading</th><th>Detail</th></tr></thead><tbody></tbody></table></div>
      </section>`;
    const cards = K().systemCards(state.sim, bid);
    const sel = el.querySelector("#sd-system");
    for (const c of cards) sel.add(new Option(c.name, c.id));
    sel.value = cards.some((c) => c.id === sysId) ? sysId : "chiller";
    sel.addEventListener("change", () => { location.hash = "system/" + sel.value; });
    el.querySelector("#sd-tabs").appendChild(U().buildingTabs(state, () => render(el, state)));
    update(el, state);
  }

  function update(el, state) {
    if (!el.querySelector("#sd-kpi-card")) return;
    const sim = state.sim, raw = state.mode === "raw";
    const bid = U().pageBuilding(state);
    const b = DEMO.BUILDINGS.find((x) => x.id === bid);
    const sysId = el.querySelector("#sd-system").value;
    const card = K().systemCards(sim, bid).find((c) => c.id === sysId);
    const st = sim.state[bid];
    const { span, chip } = U();

    el.querySelector("#sd-name").textContent = card.name;
    el.querySelector("#sd-sub").textContent = `${b.name} · ${b.type}, ${b.city}` + (st.offline ? " · gateway offline, showing last readings" : "");

    /* main card: KPI (KPI view) or live readings (raw view) */
    const main = el.querySelector("#sd-kpi-card");
    main.innerHTML = "";
    if (raw) {
      const h = document.createElement("div"); h.className = "card-head";
      const h2 = document.createElement("h2"); h2.textContent = "Live readings"; h.appendChild(h2);
      const dl = document.createElement("dl"); dl.className = "kv kv-lg";
      for (const [k, v] of card.raw) { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); }
      main.append(h, dl);
    } else {
      const k = card.kpi;
      const statusText = { good: "On target", warning: "Needs attention", critical: "Action needed", info: "For information" }[k.status];
      const top = document.createElement("div"); top.className = "kpi-hero";
      const left = document.createElement("div");
      const val = document.createElement("div"); val.className = "kpi-hero-value";
      val.append(span(k.value), span(k.unit, "unit"));
      left.append(span(k.label, "label"), val, span(k.target, "sys-target"));
      top.append(left, chip(statusText, k.status));
      const ins = document.createElement("p"); ins.className = "kpi-insight"; ins.textContent = k.insight;
      const exp = document.createElement("p"); exp.className = "kpi-explain"; exp.textContent = EXPLAIN[sysId] || "";
      main.append(top, ins, exp);
    }

    /* figures */
    const figs = el.querySelector("#sd-figs");
    figs.innerHTML = "";
    const total = st.totalKwh || 1;
    const add = (k, v) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; figs.append(dt, dd); };
    el.querySelector("#sd-figs-title").textContent = raw ? "Meter" : "Energy and cost";
    if (card.kw != null) {
      add("Power now", `${fmt(card.kw, 1)} kW`);
      add(raw ? "Energy since 00:00" : "Energy today", `${fmt(card.kwh)} kWh`);
      if (!raw) {
        add("Share of building energy", `${fmt(card.kwh / total * 100, 1)} %`);
        add("Cost today (approx.)", K().inr(card.kwh * (st.cost / Math.max(1, st.gridKwh + st.dgKwh))));
        const f = K().findings(sim, bid).filter((x) => x.system === sysId);
        add("Avoidable cost / month", f.length ? K().inr(f.reduce((a, x) => a + x.costMonth, 0), true) : "₹0");
      }
    } else {
      add("Building load now", `${fmt(st.last.totalKw)} kW`);
      add("Energy today", `${fmt(st.totalKwh)} kWh`);
    }
    add("Last reading", st.offline ? `${U().time(st.lastTs)} (gateway offline)` : U().time(st.lastTs));

    /* trend */
    el.querySelector("#sd-trend-note").textContent = card.kw != null ? "" : "Whole building load";
    const data = card.kw != null ? K().systemSeries(sim, bid, sysId) : st.total.slice();
    DEMO.charts.trend("chart-trend", data, raw ? getComputedStyle(document.documentElement).getPropertyValue("--ink-2").trim() : null);

    /* findings (KPI) or alarms (raw) */
    const box = el.querySelector("#sd-findings");
    box.innerHTML = "";
    const evSys = (e) => (e.system in EVENT_SYSTEM ? EVENT_SYSTEM[e.system] : e.system);
    const events = sim.events.filter((e) => e.building === bid && evSys(e) === sysId && e.kind === "fault");
    if (raw) {
      el.querySelector("#sd-find-title").textContent = "Alarms";
      const log = document.createElement("div"); log.className = "log";
      const lines = events.map((e) => ({ t: e.start, text: e.raw + (e.status === "resolved" ? " / RTN" : "") }));
      if (!lines.length) box.append(span("No active alarms.", "muted"));
      for (const x of lines) { const r = document.createElement("div"); r.append(span(U().time(x.t)), span(bid), span(x.text)); log.appendChild(r); }
      if (lines.length) box.appendChild(log);
    } else {
      el.querySelector("#sd-find-title").textContent = "Findings";
      const list = document.createElement("div"); list.className = "list";
      for (const f of K().findings(sim, bid).filter((x) => x.system === sysId)) {
        const it = document.createElement("div"); it.className = "list-item";
        const r1 = document.createElement("div"); r1.className = "list-row";
        r1.append(span(f.title, "title"), span(K().inr(f.costMonth, true) + "/mo", "money"));
        it.append(r1, span(f.detail, "meta"));
        const act = document.createElement("p"); act.className = "action"; act.textContent = "Action: " + f.action; it.appendChild(act);
        const r2 = document.createElement("div"); r2.className = "list-row";
        r2.append(span(`${fmt(f.kwhToday)} kWh wasted today`, "meta"), chip(f.activeNow ? "Happening now" : "Recurring", f.activeNow ? "critical" : "warning"));
        it.appendChild(r2);
        list.appendChild(it);
      }
      for (const e of events) {
        const it = document.createElement("div"); it.className = "list-item";
        const r1 = document.createElement("div"); r1.className = "list-row";
        r1.append(span(e.title, "title"), chip(e.status === "resolved" ? "Resolved" : e.category, e.status === "resolved" ? "good" : e.severity));
        it.append(r1, span(e.detail, "meta"));
        list.appendChild(it);
      }
      if (!list.children.length) box.append(span("No findings for this system. It is running as expected.", "muted"));
      else box.appendChild(list);
    }

    /* equipment */
    const tb = el.querySelector("#sd-equip tbody");
    tb.innerHTML = "";
    for (const row of K().equipment(sim, bid, sysId)) {
      const tr = tb.insertRow(); tr.className = "static";
      row.forEach((v, i) => {
        const c = tr.insertCell();
        if (i === 2) c.className = "n";
        if (i === 1 && !raw && /TRIP|STUCK|OPEN|FAIL/.test(v)) c.append(chip(v, "critical"));
        else c.textContent = i === 0 ? v.replace(bid + " ", "") : v;
      });
    }
  }

  DEMO.pages = DEMO.pages || {};
  DEMO.pages.system = { render, update };
})();
