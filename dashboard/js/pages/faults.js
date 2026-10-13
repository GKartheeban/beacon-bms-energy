/* =========================================================================
   Page 4 - Faults & Alerts
   KPI view: plain-language faults with impact, action, status and owner.
   Raw view: the BMS alarm list (codes, ALM / ACK / RTN states).
   ========================================================================= */

(function () {
  const fmt = (v, d) => DEMO.kpi.fmt(v, d);
  const K = () => DEMO.kpi;
  const U = () => DEMO.ui;
  const SEV_ORDER = { critical: 0, warning: 1, info: 2 };
  const RAW_STATE = { open: "ALM", acknowledged: "ACK", resolved: "RTN" };

  const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short" });
  function started(t, sim) { return t < sim.dayStart ? `${dayFmt.format(new Date(t))} ${U().time(t)}` : U().time(t); }

  function duration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
  }

  function render(el, state) {
    state.faultFilter = state.faultFilter || "open";
    el.innerHTML = `
      <div class="page-head">
        <div><h1>Faults &amp; Alerts</h1><p id="fa-sub"></p></div>
        <div class="segmented" role="group" aria-label="Show">
          <button type="button" data-f="open">Open</button>
          <button type="button" data-f="all">All</button>
          <button type="button" data-f="resolved">Resolved</button>
        </div>
      </div>
      <section class="tiles" id="fa-tiles" aria-label="Fault summary"></section>
      <section class="card gw-card">
        <div class="card-head"><div><h2>Gateway health</h2><p>One edge gateway per building sends readings every 15 minutes.</p></div></div>
        <div class="gw-grid" id="fa-gw"></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2 id="fa-list-title"></h2><p id="fa-list-note"></p></div></div>
        <div class="table-wrap"><table class="data" id="fa-table"><thead></thead><tbody></tbody></table></div>
        <p class="muted empty" id="fa-empty" hidden>Nothing to show for this filter.</p>
      </section>`;
    for (const b of el.querySelectorAll("[data-f]")) {
      b.addEventListener("click", () => { state.faultFilter = b.dataset.f; update(el, state); });
    }
    update(el, state);
  }

  function update(el, state) {
    if (!el.querySelector("#fa-tiles")) return;
    const sim = state.sim, raw = state.mode === "raw", scope = state.scope;
    const bs = K().buildingsIn(scope).filter((b) => DEMO.auth.canSee(b.id));
    const { tile, chip, span } = U();
    for (const b of el.querySelectorAll("[data-f]")) b.setAttribute("aria-pressed", String(b.dataset.f === state.faultFilter));

    el.querySelector("#fa-sub").textContent = scope === "ALL" ? `All buildings · ${bs.length} gateways` : `${bs[0].name}`;

    const all = K().faults(sim, scope);
    const faults = all.filter((e) => e.kind === "fault");
    const open = faults.filter((e) => e.status === "open");
    const ack = faults.filter((e) => e.status === "acknowledged");
    const resolvedToday = faults.filter((e) => e.status === "resolved" && e.end >= sim.dayStart);
    const gwOnline = bs.filter((b) => !sim.state[b.id].offline).length;

    /* tiles */
    const tiles = el.querySelector("#fa-tiles");
    tiles.innerHTML = "";
    if (raw) {
      tiles.append(
        tile("Active alarms", fmt(open.length + ack.length), "", "ALM + ACK"),
        tile("Unacknowledged", fmt(open.length), "", "State ALM"),
        tile("Returned to normal today", fmt(resolvedToday.length), "", "State RTN"),
        tile("Comm status", `${gwOnline} / ${bs.length}`, "", "Gateways reporting")
      );
    } else {
      const crit = open.concat(ack).filter((e) => e.severity === "critical").length;
      tiles.append(
        tile("Open faults", fmt(open.length + ack.length), "", [chip(crit ? `${crit} critical` : open.length + ack.length ? "Warnings only" : "All clear", crit ? "critical" : open.length + ack.length ? "warning" : "good")]),
        tile("Waiting for action", fmt(open.length), "", "Not yet acknowledged"),
        tile("Acknowledged", fmt(ack.length), "", "Someone is on it"),
        tile("Resolved today", fmt(resolvedToday.length), "", "Since 00:00"),
        tile("Gateways online", `${gwOnline} / ${bs.length}`, "", [chip(gwOnline === bs.length ? "All reporting" : "Data gap", gwOnline === bs.length ? "good" : "critical")])
      );
    }

    /* list */
    const f = state.faultFilter;
    let rows = (raw ? faults : all).filter((e) => f === "all" ? true : f === "resolved" ? e.status === "resolved" : e.status !== "resolved");
    rows = rows.slice().sort((a, b) => (a.status === "resolved") - (b.status === "resolved") || SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.start - a.start);
    el.querySelector("#fa-list-title").textContent = raw ? "Alarm list" : "Faults and alerts";
    el.querySelector("#fa-list-note").textContent = raw ? "As reported by the BMS." : "Sorted by status and severity. Acknowledge a fault to show it is being handled.";

    const table = el.querySelector("#fa-table");
    /* redraw the list only when it changes, so buttons stay clickable between readings */
    const sig = [state.mode, f, ...rows.map((e) => e.id + ":" + e.status)].join("|");
    if (table.dataset.sig === sig) {
      for (const td of table.querySelectorAll("td[data-start]")) td.textContent = duration((Number(td.dataset.end) || sim.t) - Number(td.dataset.start));
    } else {
    table.dataset.sig = sig;
    const head = raw ? ["Time", "Bldg", "Message", "State", ""] : ["Severity", "Fault", "Building", "Started", "Duration", "Status", ""];
    table.tHead.innerHTML = "";
    const hr = table.tHead.insertRow();
    for (const h of head) { const th = document.createElement("th"); th.textContent = h; hr.appendChild(th); }
    const tb = table.tBodies[0];
    tb.innerHTML = "";
    for (const e of rows) {
      const tr = tb.insertRow(); tr.className = "static";
      const b = DEMO.BUILDINGS.find((x) => x.id === e.building);
      const ackBtn = () => {
        if (e.kind !== "fault" || e.status !== "open") {
          const s = span(e.status === "acknowledged" && e.ackBy ? `by ${e.ackBy.split(" ")[0]}` : "", "muted"); return s;
        }
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "btn btn-sm"; btn.textContent = raw ? "ACK" : "Acknowledge";
        btn.addEventListener("click", () => { e.status = "acknowledged"; e.ackBy = state.user.name; e.ackAt = sim.t; table.dataset.sig = ""; update(el, state); });
        return btn;
      };
      const cell = (v, cls) => { const c = tr.insertCell(); if (cls) c.className = cls; if (v instanceof Node) c.append(v); else c.textContent = v; return c; };
      if (raw) {
        cell(started(e.start, sim), "num");
        cell(e.building);
        cell(e.raw || e.title, "num");
        cell(RAW_STATE[e.status] || "-", "num");
        cell(ackBtn());
      } else {
        const sevText = { critical: "Critical", warning: "Warning", info: "Info" }[e.severity];
        cell(chip(sevText, e.severity));
        const c = cell(""); c.className = "wrap";
        c.append(span(e.title, "bname"));
        if (e.detail) { c.append(document.createElement("br"), span(e.detail, "bsub")); }
        if (e.action && e.status !== "resolved") { const p = document.createElement("div"); p.className = "action"; p.textContent = "Action: " + e.action; c.append(p); }
        cell(b ? b.name : e.building);
        cell(started(e.start, sim), "num");
        const dc = cell(duration((e.end || sim.t) - e.start), "num");
        dc.dataset.start = e.start; if (e.end) dc.dataset.end = e.end;
        const statusText = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved" }[e.status];
        cell(chip(statusText, e.status === "resolved" ? "good" : e.status === "acknowledged" ? "info" : e.severity));
        cell(ackBtn());
      }
    }
    }
    el.querySelector("#fa-empty").hidden = rows.length > 0;
    table.hidden = rows.length === 0;

    /* gateway health */
    const gw = el.querySelector("#fa-gw");
    gw.innerHTML = "";
    const slot = K().curSlot(sim);
    for (const b of bs) {
      const st = sim.state[b.id];
      const got = st.total.slice(0, slot + 1).filter((v) => v != null).length;
      const it = document.createElement("div"); it.className = "gw-item";
      const r1 = document.createElement("div"); r1.className = "list-row";
      r1.append(span(`${b.name}`, "title"), raw ? span(st.offline ? "COMM FAIL" : "COMM OK", "num") : chip(st.offline ? "Offline" : "Online", st.offline ? "critical" : "good"));
      const r2 = document.createElement("div"); r2.className = "list-row";
      r2.append(span(`GW-${b.id}-01 · last reading ${U().time(st.lastTs)}`, "meta"), span(`${got} / ${slot + 1} readings today`, "meta"));
      it.append(r1, r2);
      if (st.offline && !raw) {
        const p = document.createElement("p"); p.className = "meta";
        p.textContent = `Offline for ${duration(sim.t - st.offlineSince)}. ${st.buffer.length} readings are waiting on the gateway and will be sent when it reconnects.`;
        it.appendChild(p);
      }
      gw.appendChild(it);
    }
  }

  DEMO.pages = DEMO.pages || {};
  DEMO.pages.faults = { render, update };
})();
