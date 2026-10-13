/* =========================================================================
   Page 5 - Energy Insights
   KPI view: where energy is wasted, ranked by money, with actions,
   plus a 7-day hour-by-hour heatmap.
   Raw view: the BMS only has interval readings; there are no insights.
   ========================================================================= */

(function () {
  const fmt = (v, d) => DEMO.kpi.fmt(v, d);
  const K = () => DEMO.kpi;
  const U = () => DEMO.ui;
  const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit" });

  function render(el, state) {
    el.innerHTML = `
      <div class="page-head">
        <div><h1>Energy Insights</h1><p id="in-sub"></p></div>
        <p class="mode-note" id="in-note"></p>
      </div>
      <div id="in-body"></div>`;
    update(el, state, true);
  }

  function update(el, state, fresh) {
    const body = el.querySelector("#in-body");
    if (!body) return;
    const sim = state.sim, raw = state.mode === "raw", scope = state.scope;
    const bs = K().buildingsIn(scope).filter((b) => DEMO.auth.canSee(b.id));
    const { tile, chip, span } = U();
    el.querySelector("#in-sub").textContent = scope === "ALL" ? "All buildings · waste found in the readings, ranked by cost" : `${bs[0].name} · waste found in the readings, ranked by cost`;
    el.querySelector("#in-note").textContent = raw ? "Raw data: interval readings only." : "KPI view: readings compared with schedules, occupancy and targets.";

    if (raw) {
      if (!body.querySelector("#in-raw")) {
        DEMO.charts.dispose("chart-heatmap");
        body.innerHTML = `
          <div class="notice" id="in-raw">
            <b>No insights in raw data.</b>
            <span>The BMS records readings, but it does not compare them with schedules, occupancy or targets. Switch to <b>KPI view</b> to see where energy is wasted.</span>
          </div>
          <section class="card">
            <div class="card-head"><div><h2>Interval readings, last 24 hours</h2><p>Hourly energy from the main meter, as stored by the BMS.</p></div></div>
            <div class="table-wrap"><table class="data" id="in-int"><thead><tr><th>Hour</th></tr></thead><tbody></tbody></table></div>
          </section>`;
      }
      const table = body.querySelector("#in-int");
      const hr = table.tHead.rows[0];
      while (hr.cells.length > 1) hr.deleteCell(1);
      for (const b of bs) { const th = document.createElement("th"); th.className = "n"; th.textContent = `${b.id} kWh`; hr.appendChild(th); }
      const tb = table.tBodies[0]; tb.innerHTML = "";
      const nowH = new Date(sim.t).getHours();
      for (let i = 0; i < 24; i++) {
        const h = (nowH - i + 24) % 24;
        const day = h > nowH ? 5 : 6;
        const tr = tb.insertRow(); tr.className = "static";
        const c0 = tr.insertCell(); c0.className = "num"; c0.textContent = `${day === 5 ? "Yesterday " : ""}${String(h).padStart(2, "0")}:00`;
        for (const b of bs) { const c = tr.insertCell(); c.className = "n"; c.textContent = fmt(sim.state[b.id].hourly[day][h]); }
      }
      return;
    }

    /* ---------- KPI view ---------- */
    if (!body.querySelector("#in-kpi")) {
      body.innerHTML = `
        <div id="in-kpi">
          <section class="tiles" id="in-tiles"></section>
          <section class="split">
            <div class="card">
              <div class="card-head"><div><h2>Energy by hour, last 7 days</h2><p>Darker cells use more energy. Dark cells at night or on weekends point to waste.</p></div></div>
              <div class="chart chart-heat" id="chart-heatmap" role="img" aria-label="Energy by day and hour, last 7 days"></div>
            </div>
            <div class="card">
              <div class="card-head"><h2>Savings by building</h2></div>
              <div class="table-wrap"><table class="data compact" id="in-bld"><thead><tr><th>Building</th><th class="n">Per month</th><th class="n">Share of bill</th></tr></thead><tbody></tbody></table></div>
              <p class="chart-note">Share of bill: savings found compared with the building's 7-day average energy cost.</p>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><div><h2>Findings</h2><p>Each finding is a pattern found in the readings, with its cost and a recommended action.</p></div></div>
            <div class="findings" id="in-list"></div>
          </section>
        </div>`;
    }

    const all = K().findings(sim, scope);
    const t = K().totals(sim, scope);
    const totalMonth = all.reduce((a, f) => a + f.costMonth, 0);
    const active = all.filter((f) => f.activeNow).length;

    const tiles = body.querySelector("#in-tiles");
    tiles.innerHTML = "";
    tiles.append(
      tile("Savings found", K().inr(totalMonth, true), "/ month", `About ${K().inr(totalMonth * 12, true)} a year`, "accent"),
      tile("Wasted so far today", K().inr(t.wasteToday), "", `${fmt(t.wasteKwhToday)} kWh`),
      tile("Share of today's energy", fmt(t.kwh ? t.wasteKwhToday / t.kwh * 100 : 0, 1), "%", "Avoidable without new equipment"),
      tile("Findings", fmt(all.length), "", [chip(`${active} happening now`, active ? "critical" : "good")])
    );

    /* heatmap */
    const labels = Array.from({ length: 7 }, (_, d) => d === 6 ? "Today" : dayFmt.format(new Date(sim.dayStart - (6 - d) * 86400000)));
    DEMO.charts.heatmap(K().heatmap(sim, scope), labels);

    /* savings by building */
    const tb = body.querySelector("#in-bld tbody");
    tb.innerHTML = "";
    for (const b of bs) {
      const f = all.filter((x) => x.building.id === b.id);
      const m = f.reduce((a, x) => a + x.costMonth, 0);
      const st = sim.state[b.id];
      const avgDayCost = st.dayTotals.slice(0, 6).reduce((a, v) => a + v, 0) / 6 * 8.8;
      const tr = tb.insertRow(); tr.className = "static";
      const c0 = tr.insertCell(); c0.append(span(b.name, "bname"), document.createElement("br"), span(`${f.length} findings`, "bsub"));
      const c1 = tr.insertCell(); c1.className = "n"; c1.textContent = K().inr(m, true);
      const c2 = tr.insertCell(); c2.className = "n"; c2.textContent = `${fmt(m / (avgDayCost * 30) * 100, 1)} %`;
    }

    /* findings: rebuild only when the order or "happening now" changes, so links stay clickable */
    const list = body.querySelector("#in-list");
    const sig = all.map((f) => f.id + (f.activeNow ? "1" : "0")).join("|");
    if (list.dataset.sig === sig && !fresh) {
      for (const f of all) {
        const row = list.querySelector(`[data-id="${f.id}"]`); if (!row) continue;
        row.querySelector(".f-month").textContent = K().inr(f.costMonth, true) + " / month";
        row.querySelector(".f-today").textContent = `${K().inr(f.costToday)} · ${fmt(f.kwhToday)} kWh today`;
      }
      return;
    }
    list.dataset.sig = sig;
    list.innerHTML = "";
    const sevText = { critical: "High impact", warning: "Medium impact", info: "Low impact" };
    for (const f of all) {
      const row = document.createElement("article"); row.className = "finding"; row.dataset.id = f.id;
      const main = document.createElement("div"); main.className = "f-main";
      const top = document.createElement("div"); top.className = "f-top";
      top.append(chip(sevText[f.severity], f.severity), chip(f.activeNow ? "Happening now" : "Recurring", f.activeNow ? "critical" : ""));
      const h3 = document.createElement("h3"); h3.textContent = f.title;
      const where = span(`${f.building.name} · ${DEMO.SYSTEMS.find((s) => s.id === f.system).name}`, "meta");
      const det = document.createElement("p"); det.className = "f-detail"; det.textContent = f.detail;
      const act = document.createElement("p"); act.className = "action"; act.append(span("Action: ", "f-act-label"), f.action);
      main.append(top, h3, where, det, act);
      const side = document.createElement("div"); side.className = "f-side";
      side.append(span(K().inr(f.costMonth, true) + " / month", "money f-month"), span(`${K().inr(f.costToday)} · ${fmt(f.kwhToday)} kWh today`, "meta f-today"));
      const open = document.createElement("button"); open.type = "button"; open.className = "btn btn-sm"; open.textContent = "Open system";
      open.addEventListener("click", () => { state.pageBuilding = f.building.id; location.hash = "system/" + f.system; });
      side.appendChild(open);
      row.append(main, side);
      list.appendChild(row);
    }
  }

  DEMO.pages = DEMO.pages || {};
  DEMO.pages.insights = { render, update: (el, state) => update(el, state, false) };
})();
