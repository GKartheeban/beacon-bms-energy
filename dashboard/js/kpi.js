/* =========================================================================
   kpi.js - turns raw readings into KPIs, findings and display values.
   This is the "processing layer": in the real system the same rules run on
   the backend. Scope = one building id, or "ALL" for the portfolio.
   ========================================================================= */

(function () {
  const T = DEMO.KPI_TARGETS;
  const SLOTS = () => DEMO.SLOTS;

  function buildingsIn(scope) {
    return scope === "ALL" ? DEMO.BUILDINGS : DEMO.BUILDINGS.filter((b) => b.id === scope);
  }
  function curSlot(sim) { return Math.min(DEMO.SLOTS - 1, Math.floor((sim.t - sim.dayStart) / DEMO.STEP_MS)); }
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function sumSeries(arrays) {
    const out = new Array(DEMO.SLOTS).fill(null);
    for (let i = 0; i < DEMO.SLOTS; i++) {
      let v = 0, any = false;
      for (const a of arrays) { if (a[i] != null) { v += a[i]; any = true; } }
      out[i] = any ? v : null;
    }
    return out;
  }

  /* ---- headline numbers for the tiles ---- */
  function totals(sim, scope) {
    const bs = buildingsIn(scope);
    const slot = curSlot(sim);
    let kw = 0, eff = 0, solar = 0, kwh = 0, cost = 0, yKwh = 0, area = 0, meter = 0, pfw = 0, tout = 0, maxKva = 0, gridKw = 0, dgKw = 0;
    let sevenDay = 0, wasteMonth = 0, wasteToday = 0, wasteKwhToday = 0, offline = [];
    for (const b of bs) {
      const st = sim.state[b.id], l = st.last;
      kw += l.totalKw; eff += l.totalKw - l.wasteKw; solar += l.solar; gridKw += l.grid; dgKw += l.dg;
      kwh += st.totalKwh; cost += st.cost; area += b.areaM2; meter += st.meter; pfw += l.pf * l.totalKw;
      tout += l.tout; maxKva += st.maxKva;
      for (let i = 0; i <= slot; i++) yKwh += (st.yesterday[i] || 0) * 0.25;
      sevenDay += sum(st.dayTotals.slice(0, 6)) / 6;
      for (let d = 0; d < 6; d++) for (const id in st.wasteCostDays[d]) wasteMonth += st.wasteCostDays[d][id] / 6 * 30;
      for (const id in st.wasteCost) wasteToday += st.wasteCost[id];
      for (const id in st.wasteKwh) wasteKwhToday += st.wasteKwh[id];
      if (st.offline) offline.push(b);
    }
    const open = sim.events.filter((e) => e.kind === "fault" && e.status !== "resolved" && bs.some((b) => b.id === e.building));
    return {
      kw, eff, solar, gridKw, dgKw, kwh, cost, yKwh, area, meter, pf: kw ? pfw / kw : 0.95, tout: tout / bs.length, maxKva,
      eui: sevenDay * 365 / area, wasteMonth, wasteToday, wasteKwhToday, offline,
      faultsOpen: open.length, faultsCritical: open.filter((e) => e.severity === "critical").length,
      overBaseline: eff > 0 ? (kw - eff) / eff : 0,
      vsYesterday: yKwh > 0 ? (kwh - yKwh) / yKwh : 0
    };
  }

  /* ---- chart series ---- */
  function series(sim, scope) {
    const bs = buildingsIn(scope);
    const groups = {};
    for (const g of DEMO.GROUPS) {
      const arrays = [];
      for (const b of bs) for (const s of DEMO.SYSTEMS) if (s.group === g.id) arrays.push(sim.state[b.id].series[s.id]);
      groups[g.id] = sumSeries(arrays);
    }
    return {
      groups,
      total: sumSeries(bs.map((b) => sim.state[b.id].total)),
      efficient: sumSeries(bs.map((b) => sim.state[b.id].efficient)),
      yesterday: sumSeries(bs.map((b) => sim.state[b.id].yesterday)),
      solar: sumSeries(bs.map((b) => sim.state[b.id].solar)),
      grid: sumSeries(bs.map((b) => sim.state[b.id].grid))
    };
  }

  function systemSeries(sim, scope, sysId) {
    return sumSeries(buildingsIn(scope).map((b) => sim.state[b.id].series[sysId]));
  }

  function systemKwh(sim, scope) {
    const bs = buildingsIn(scope);
    return DEMO.SYSTEMS.map((s) => ({
      id: s.id, name: s.name,
      kwh: sum(bs.map((b) => sim.state[b.id].kwh[s.id])),
      kw: sum(bs.map((b) => sim.state[b.id].last.kw[s.id]))
    }));
  }

  function heatmap(sim, scope) {
    const bs = buildingsIn(scope);
    const out = [];
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
      out.push([h, d, Math.round(sum(bs.map((b) => sim.state[b.id].hourly[d][h])))]);
    }
    return out;
  }

  /* ---- findings: planted waste, with today's and monthly cost ---- */
  function findings(sim, scope) {
    const bs = buildingsIn(scope);
    const out = [];
    for (const w of DEMO.WASTE) {
      if (!bs.some((b) => b.id === w.building)) continue;
      const st = sim.state[w.building];
      let month = 0;
      for (let d = 0; d < 6; d++) month += (st.wasteCostDays[d][w.id] || 0) / 6 * 30;
      const l = st.last;
      const activeNow = l.waste[w.id] != null;
      const kwtr = st.trh > 0 ? (st.kwh.chiller / st.trh).toFixed(2) : l.kwtr.toFixed(2);
      out.push({
        ...w, building: DEMO.BUILDINGS.find((b) => b.id === w.building),
        detail: w.detail.replace("{kwtr}", kwtr),
        kwhToday: st.wasteKwh[w.id] || 0, costToday: st.wasteCost[w.id] || 0, costMonth: month,
        activeNow, kwNow: activeNow ? l.waste[w.id] : 0
      });
    }
    return out.sort((a, b) => b.costMonth - a.costMonth);
  }

  function faults(sim, scope) {
    const bs = buildingsIn(scope);
    return sim.events.filter((e) => bs.some((b) => b.id === e.building));
  }

  /* ---- status helper ---- */
  const status = (v, good, warn, lowerIsBetter = true) =>
    lowerIsBetter ? (v <= good ? "good" : v <= warn ? "warning" : "critical")
                  : (v >= good ? "good" : v >= warn ? "warning" : "critical");

  function wasteFor(sim, bs, sysId) {
    let kwh = 0, cost = 0, first = null;
    for (const w of DEMO.WASTE) {
      if (w.system !== sysId || !bs.some((b) => b.id === w.building)) continue;
      const st = sim.state[w.building];
      kwh += st.wasteKwh[w.id] || 0; cost += st.wasteCost[w.id] || 0;
      if (!first) first = w;
    }
    return { kwh, cost, first };
  }

  const fmt = (v, d = 0) => (v == null || isNaN(v)) ? "-" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

  /* ---- system cards: raw readings + KPI for each system ---- */
  function systemCards(sim, scope) {
    const bs = buildingsIn(scope);
    const L = (b) => sim.state[b.id].last;
    const S = (b) => sim.state[b.id];
    const sKw = (id) => sum(bs.map((b) => L(b).kw[id]));
    const sKwh = (id) => sum(bs.map((b) => S(b).kwh[id]));
    const one = bs.length === 1 ? bs[0] : null;
    const cards = [];

    /* Chiller plant */
    {
      const tr = sum(bs.map((b) => L(b).tr));
      const trh = sum(bs.map((b) => S(b).trh));
      const kwtr = trh > 0 ? sKwh("chiller") / trh : 0;
      const dts = bs.filter((b) => L(b).tr > 0).map((b) => L(b).dT);
      const dT = dts.length ? sum(dts) / dts.length : null;
      const on = sum(bs.map((b) => L(b).chillersOn)), units = sum(bs.map((b) => b.chiller.units));
      const chws = one ? L(one).chws : 6.8, chwr = one && L(one).tr > 0 ? L(one).chwr : null;
      cards.push({
        id: "chiller", name: "Chiller Plant", kw: sKw("chiller"), kwh: sKwh("chiller"),
        raw: [["Chillers running", `${on} / ${units}`], ["CHW supply / return", chwr ? `${fmt(chws, 1)} / ${fmt(chwr, 1)} °C` : `${fmt(chws, 1)} °C / -`],
              ["CHW flow", `${fmt(sum(bs.map((b) => L(b).flow)))} m³/h`], ["Cooling load", `${fmt(tr)} TR`]],
        kpi: { label: "Plant efficiency today", value: trh >= 1 ? fmt(kwtr, 2) : "-", unit: "kW/TR", target: "Target ≤ 0.65",
               status: trh >= 1 ? status(kwtr, 0.70, 0.80) : "info",
               insight: dT != null && dT < 4.5 ? `Low chilled water ΔT ${fmt(dT, 1)} °C (design 5.5 °C)` : dT != null ? `ΔT ${fmt(dT, 1)} °C, close to design` : trh >= 1 ? "Plant off now" : "Plant has not run yet today" }
      });
    }

    /* AHU / FCU */
    {
      const w = wasteFor(sim, bs, "airside");
      const trip = sim.events.find((e) => e.ref === "ahu" && e.status !== "resolved" && bs.some((b) => b.id === e.building));
      const ahus = sum(bs.map((b) => (b.type === "Mall" ? 12 : b.type === "Hotel" ? 6 : 8)));
      const running = sum(bs.map((b) => { const n = b.type === "Mall" ? 12 : b.type === "Hotel" ? 6 : 8; const k = L(b).kw.airside / b.loads.airside; return Math.min(n, Math.round(n * Math.min(1, k * 1.25))); })) - (trip ? 1 : 0);
      const rt = sum(bs.map((b) => L(b).roomTemp)) / bs.length;
      cards.push({
        id: "airside", name: "AHU / FCU", kw: sKw("airside"), kwh: sKwh("airside"),
        raw: [["AHUs running", `${Math.max(0, running)} / ${ahus}`], ["Avg room temp", `${fmt(rt, 1)} °C`], ["Avg setpoint", "22.0 °C"]],
        kpi: { label: "Avoidable fan & AC energy today", value: fmt(w.kwh), unit: "kWh", target: "Target 0",
               status: trip ? "critical" : w.kwh > 1 ? "warning" : "good",
               insight: trip ? "AHU-03 tripped, zone warming up" : w.first ? w.first.title : "All units on schedule" }
      });
    }

    /* Lighting */
    {
      const w = wasteFor(sim, bs, "lighting");
      const area = sum(bs.map((b) => b.areaM2));
      const lpd = sKw("lighting") * 1000 / area;
      const lim = one ? (one.type === "Mall" ? 13 : one.type === "Hotel" ? 10 : 9.5) : 11;
      cards.push({
        id: "lighting", name: "Lighting", kw: sKw("lighting"), kwh: sKwh("lighting"),
        raw: [["Zones ON", `${fmt(sum(bs.map((b) => Math.round(18 * L(b).kw.lighting / b.loads.lighting))))} / ${18 * bs.length}`], ["Lighting load", `${fmt(sKw("lighting"))} kW`]],
        kpi: { label: "After-hours / avoidable lighting today", value: fmt(w.kwh), unit: "kWh", target: `Power density now ${fmt(lpd, 1)} W/m² (limit ${lim})`,
               status: w.kwh > 1 ? "warning" : "good", insight: w.first ? w.first.title : "Lighting follows occupancy" }
      });
    }

    /* Ventilation */
    {
      const w = wasteFor(sim, bs, "vent");
      const co = bs.filter((b) => L(b).carParkCO != null).map((b) => L(b).carParkCO);
      cards.push({
        id: "vent", name: "Ventilation & Exhaust", kw: sKw("vent"), kwh: sKwh("vent"),
        raw: [["Exhaust fan groups ON", `${fmt(sum(bs.map((b) => Math.round(6 * Math.min(1, L(b).kw.vent / b.loads.vent)))))} / ${6 * bs.length}`], ["Car park CO", co.length ? `${fmt(co[0], 0)} ppm` : "-"]],
        kpi: { label: "Avoidable fan energy today", value: fmt(w.kwh), unit: "kWh", target: "Fans should follow CO / CO₂",
               status: w.kwh > 1 ? "warning" : "good", insight: w.first ? w.first.title : "Fan speed matches demand" }
      });
    }

    /* Vertical transport */
    {
      const w = wasteFor(sim, bs, "vertical");
      const share = sKwh("vertical") / Math.max(1, sum(bs.map((b) => S(b).totalKwh))) * 100;
      cards.push({
        id: "vertical", name: "Elevators & Escalators", kw: sKw("vertical"), kwh: sKwh("vertical"),
        raw: [["Elevators in service", `${fmt(sum(bs.map((b) => (b.type === "Mall" ? 4 : b.type === "Hotel" ? 3 : 4))))}`], ["Escalators running", one && one.type !== "Mall" ? "-" : `${L(DEMO.BUILDINGS[2]).occ > 0.05 || L(DEMO.BUILDINGS[2]).waste["csm-escalators"] ? 8 : 0} / 8`]],
        kpi: w.first
          ? { label: "Running with no passengers today", value: fmt(w.kwh), unit: "kWh", target: "Target 0", status: w.kwh > 1 ? "warning" : "good", insight: w.first.title }
          : { label: "Share of building energy", value: fmt(share, 1), unit: "%", target: "Typical 3-7%", status: "good", insight: "Standby mode in use" }
      });
    }

    /* Hot water */
    {
      const hotel = bs.find((b) => b.type === "Hotel");
      const tank = hotel ? 68 : 60;
      cards.push({
        id: "hotwater", name: "Hot Water / Heat Pumps", kw: sKw("hotwater"), kwh: sKwh("hotwater"),
        raw: [["Tank temperature", `${fmt(tank + (Math.random() - 0.5) * 0.4, 1)} °C`], ["Heat pumps running", `${fmt(sum(bs.map((b) => (L(b).kw.hotwater > b.loads.hotwater * 0.3 ? 2 : 1))))}`]],
        kpi: { label: "Storage temperature vs setpoint", value: hotel ? "+8.0" : "0.0", unit: "°C", target: "Setpoint 60 °C (do not go below)",
               status: hotel ? "warning" : "good", insight: hotel ? "Hotel tanks stored at 68 °C" : "Stored at the safe setpoint" }
      });
    }

    /* Water pumping */
    {
      const m3 = sKwh("water") / 0.41;
      cards.push({
        id: "water", name: "Water Pumping", kw: sKw("water"), kwh: sKwh("water"),
        raw: [["Water pumped today", `${fmt(m3)} m³`], ["Overhead tank", `${fmt(62 + 20 * Math.sin(sim.t / 5e6))} %`]],
        kpi: { label: "Specific pumping energy", value: fmt(sKwh("water") / Math.max(1, m3), 2), unit: "kWh/m³", target: "Target ≤ 0.45",
               status: "good", insight: "Pumps within normal range" }
      });
    }

    /* Cold rooms */
    {
      const hotel = bs.find((b) => b.type === "Hotel");
      const doorMin = hotel ? Math.round((S(hotel).wasteKwh["grh-coldroom-door"] || 0) / 4 * 60 * 0.42) : 0;
      cards.push({
        id: "cold", name: "Cold Rooms", kw: sKw("cold"), kwh: sKwh("cold"),
        raw: [["Cold room temp", `${fmt(one ? L(one).coldTemp : 3.4, 1)} °C`], ["Door", hotel && L(hotel).doorOpen ? "OPEN" : "CLOSED"]],
        kpi: { label: "Door open time today", value: fmt(doorMin), unit: "min", target: "Target ≤ 10 min/day",
               status: doorMin > 10 ? "warning" : "good", insight: hotel && doorMin > 0 ? "Kitchen cold room 2 door left open" : "Doors closed, temperature stable" }
      });
    }

    /* UPS */
    {
      const out = sum(bs.map((b) => L(b).upsOut));
      const loss = sKw("ups");
      const eff = out / (out + loss);
      cards.push({
        id: "ups", name: "UPS", kw: loss, kwh: sKwh("ups"),
        raw: [["UPS output", `${fmt(out, 1)} kW`], ["UPS input", `${fmt(out + loss, 1)} kW`], ["Mode", "ONLINE"]],
        kpi: { label: "UPS efficiency", value: fmt(eff * 100, 1), unit: "%", target: "Target ≥ 94%",
               status: status(eff * 100, 94, 91, false), insight: eff < 0.9 ? "Office UPS at 18% load: low efficiency" : eff < 0.94 ? "Slightly below target" : "Operating efficiently" }
      });
    }

    /* STP / WTP */
    {
      const office = bs.find((b) => b.type === "Office");
      cards.push({
        id: "plants", name: "STP / WTP", kw: sKw("plants"), kwh: sKwh("plants"),
        raw: [["STP blowers", "2 RUN"], ["DO (aeration tank)", `${office ? "3.6" : "2.1"} mg/L`], ["RO plant", "RUN"]],
        kpi: { label: "STP dissolved oxygen", value: office ? "3.6" : "2.1", unit: "mg/L", target: "Target 2.0 mg/L",
               status: office ? "warning" : "good", insight: office ? "Over-aeration: blowers working too hard" : "Aeration on target" }
      });
    }

    /* Kitchen, laundry, pool */
    {
      const share = sKwh("kitchen") / Math.max(1, sum(bs.map((b) => S(b).totalKwh))) * 100;
      cards.push({
        id: "kitchen", name: "Kitchen, Laundry & Pool", kw: sKw("kitchen"), kwh: sKwh("kitchen"),
        raw: [["Kitchen load", `${fmt(sKw("kitchen"))} kW`]],
        kpi: { label: "Share of building energy", value: fmt(share, 1), unit: "%", target: "Tracked per meal / kg of linen",
               status: "info", insight: "Peaks follow meal times" }
      });
    }

    /* Sockets / IT / tenants */
    {
      const night = sum(bs.map((b) => { const s = S(b).series.plug; return s[12] != null ? s[12] : 0; }));
      cards.push({
        id: "plug", name: "Sockets, IT & Tenants", kw: sKw("plug"), kwh: sKwh("plug"),
        raw: [["Distribution boards", `${fmt(sKw("plug"))} kW`]],
        kpi: { label: "Night base load (03:00)", value: fmt(night), unit: "kW", target: "Equipment left on overnight",
               status: "info", insight: "Base load within normal range" }
      });
    }

    /* Indoor air quality (context) */
    {
      const office = bs.find((b) => b.type === "Office");
      const co2 = sum(bs.map((b) => L(b).co2)) / bs.length;
      cards.push({
        id: "iaq", name: "Indoor Air Quality", kw: null, kwh: null,
        raw: [["CO₂ (avg)", `${fmt(co2)} ppm`], ["Temperature (avg)", `${fmt(sum(bs.map((b) => L(b).roomTemp)) / bs.length, 1)} °C`], ["IAQ-F3 CO₂", office ? "412 ppm" : "-"]],
        kpi: { label: "Comfort compliance today", value: office ? "91" : "97", unit: "%", target: "CO₂ 600-1,000 ppm, 23-26 °C",
               status: office ? "warning" : "good", insight: office ? "Sensor IAQ-F3 frozen at 412 ppm" : "Air quality within limits" }
      });
    }

    /* Energy supply: solar and DG */
    {
      const solarKwh = sum(bs.map((b) => S(b).solarKwh)), total = sum(bs.map((b) => S(b).totalKwh));
      const dgMin = sum(bs.map((b) => S(b).dgRunMin));
      cards.push({
        id: "supply", name: "Solar & Diesel Generator", kw: null, kwh: null,
        raw: [["Solar output", `${fmt(sum(bs.map((b) => L(b).solar)))} kW`], ["DG-1", sum(bs.map((b) => L(b).dg)) > 0 ? "RUN" : "STOP"], ["Power factor", fmt(sum(bs.map((b) => L(b).pf)) / bs.length, 2)]],
        kpi: { label: "Solar share of energy today", value: fmt(solarKwh / Math.max(1, total) * 100, 1), unit: "%", target: `DG run today: ${dgMin} min`,
               status: dgMin > 0 ? "warning" : "good", insight: dgMin > 0 ? `Diesel used during grid outage (~₹${DEMO.TARIFF.diesel}/kWh)` : "No diesel used today" }
      });
    }

    return cards;
  }

  /* ---- equipment-level raw readings for the detail drawer ---- */
  function equipment(sim, scope, sysId) {
    const rows = [];
    for (const b of buildingsIn(scope)) {
      const l = sim.state[b.id].last;
      const tag = (s) => `${b.id} ${s}`;
      const on = (x) => (x ? "ON" : "OFF");
      if (sysId === "chiller") {
        for (let i = 1; i <= b.chiller.units; i++) {
          const run = i <= l.chillersOn;
          rows.push([tag(`CH-${i}`), on(run), run ? `${(l.kw.chiller * 0.78 / l.chillersOn).toFixed(0)} kW` : "0 kW", run ? `${Math.min(100, l.tr / l.chillersOn / b.chiller.unitTR * 100).toFixed(0)} % load` : "-"]);
        }
        rows.push([tag("CHWP-1"), on(l.tr > 0), `${(l.kw.chiller * 0.12).toFixed(0)} kW`, l.tr > 0 ? "VFD 100 %" : "-"]);
        rows.push([tag("CT-1"), on(l.tr > 0), `${(l.kw.chiller * 0.10).toFixed(0)} kW`, l.tr > 0 ? `${(29 + l.tout * 0.1).toFixed(1)} °C leaving` : "-"]);
        rows.push([tag("CHW header"), "-", `${l.chws.toFixed(1)} / ${l.tr > 0 ? l.chwr.toFixed(1) : "-"} °C`, `${l.flow.toFixed(0)} m³/h`]);
      } else if (sysId === "airside") {
        const n = b.type === "Mall" ? 12 : b.type === "Hotel" ? 6 : 8;
        for (let i = 1; i <= Math.min(n, 8); i++) {
          let run = l.kw.airside > 0.05 * b.loads.airside;
          if (b.id === "TPA" && (i === 6 || i === 7)) run = true;
          if (b.id === "GRH" && i === 3 && sim.state[b.id].ahuTrip) { rows.push([tag("AHU-03"), "TRIP", "0 kW", "-"]); continue; }
          rows.push([tag(`AHU-0${i}`), on(run), run ? `${(b.loads.airside / n * (0.4 + 0.5 * l.occ)).toFixed(1)} kW` : "0 kW", run ? `SAT ${(13 + Math.random()).toFixed(1)} °C` : "-"]);
        }
        if (b.type === "Hotel") rows.push([tag("Guest FCUs"), `${92 + 9} ON`, "-", "9 in unsold rooms"]);
      } else if (sysId === "lighting") {
        const zones = b.type === "Office" ? ["Floor 1-4", "Floor 5", "Floor 6-8", "External"] : b.type === "Hotel" ? ["Lobby", "Corridors", "Guest rooms", "Facade"] : ["Atrium", "Retail L1-L4", "Facade / signage", "Car park"];
        zones.forEach((z, i) => rows.push([tag(z), on(l.occ > 0.1 || (b.id === "TPA" && i === 1 && l.waste["tpa-lights-f5"]) || (b.id === "CSM" && i === 2 && l.waste["csm-facade"]) || b.type === "Hotel"), `${(l.kw.lighting / zones.length).toFixed(0)} kW`, "-"]));
      } else if (sysId === "vent") {
        rows.push([tag("Toilet exhaust"), on(true), `${(l.kw.vent * 0.3).toFixed(0)} kW`, "-"]);
        rows.push([tag("Kitchen exhaust"), on(l.occ > 0.1), `${(l.kw.vent * 0.3).toFixed(0)} kW`, "-"]);
        if (b.type === "Mall") rows.push([tag("Car park jet fans"), "ON", `${(l.kw.vent * 0.4).toFixed(0)} kW`, `Speed ${l.waste["csm-carpark-fans"] ? 100 : Math.round(30 + 60 * l.occ)} % · CO ${l.carParkCO.toFixed(0)} ppm`]);
      } else if (sysId === "vertical") {
        const lifts = b.type === "Hotel" ? 3 : 4;
        for (let i = 1; i <= lifts; i++) rows.push([tag(`Lift L${i}`), l.occ > 0.1 ? "RUN" : "IDLE", `${(l.kw.vertical / (lifts + (b.type === "Mall" ? 8 : 0))).toFixed(1)} kW`, "-"]);
        if (b.type === "Mall") rows.push([tag("Escalators ×8"), l.occ > 0.05 || l.waste["csm-escalators"] ? "RUN" : "STOP", `${(l.kw.vertical * 0.6).toFixed(0)} kW`, l.waste["csm-escalators"] ? "No footfall" : "-"]);
      } else if (sysId === "hotwater") {
        rows.push([tag("Heat pump HP-1"), on(true), `${(l.kw.hotwater * 0.6).toFixed(1)} kW`, "-"]);
        rows.push([tag("Storage tank"), "-", `${b.type === "Hotel" ? "68.1" : "60.2"} °C`, "Setpoint 60 °C"]);
      } else if (sysId === "water") {
        rows.push([tag("Transfer pump P-1"), on(l.kw.water > b.loads.water * 0.3), `${(l.kw.water * 0.6).toFixed(1)} kW`, "-"]);
        rows.push([tag("Booster set"), "RUN", `${(l.kw.water * 0.4).toFixed(1)} kW`, "3.2 bar"]);
      } else if (sysId === "cold") {
        rows.push([tag("Cold room 1"), "RUN", `${(l.kw.cold * 0.5).toFixed(1)} kW`, "3.1 °C"]);
        if (b.type === "Hotel") rows.push([tag("Cold room 2"), "RUN", `${(l.kw.cold * 0.5).toFixed(1)} kW`, `${l.coldTemp.toFixed(1)} °C · door ${l.doorOpen ? "OPEN" : "closed"}`]);
      } else if (sysId === "ups") {
        rows.push([tag("UPS-1"), "ONLINE", `${(l.upsOut / 2).toFixed(1)} kW out`, `${(b.loads.upsEff * 100).toFixed(0)} % eff.`]);
        rows.push([tag("UPS-2"), "ONLINE", `${(l.upsOut / 2).toFixed(1)} kW out`, `${(b.loads.upsEff * 100).toFixed(0)} % eff.`]);
      } else if (sysId === "plants") {
        rows.push([tag("STP blowers"), "RUN", `${(l.kw.plants * 0.55).toFixed(1)} kW`, `DO ${b.id === "TPA" ? "3.6" : "2.1"} mg/L`]);
        rows.push([tag("WTP RO pump"), "RUN", `${(l.kw.plants * 0.3).toFixed(1)} kW`, "Recovery 72 %"]);
      } else if (sysId === "kitchen") {
        rows.push([tag("Kitchen DB"), l.kw.kitchen > 5 ? "ON" : "IDLE", `${(l.kw.kitchen * (b.type === "Hotel" ? 0.6 : 1)).toFixed(1)} kW`, "-"]);
        if (b.type === "Hotel") {
          rows.push([tag("Laundry DB"), l.h >= 8 && l.h < 18 ? "RUN" : "IDLE", `${(l.kw.kitchen * 0.25).toFixed(1)} kW`, "-"]);
          rows.push([tag("Pool heating"), "ON", `${(l.kw.kitchen * 0.15).toFixed(1)} kW`, "Water 28.2 °C"]);
        }
      } else if (sysId === "plug") {
        const n = Math.min(b.floors, 4);
        for (let i = 1; i <= n; i++) rows.push([tag(`Floor DB-${i}`), "ON", `${(l.kw.plug / n).toFixed(1)} kW`, "-"]);
      } else if (sysId === "iaq") {
        for (let i = 1; i <= Math.min(b.floors, 4); i++) {
          const stuck = b.id === "TPA" && i === 3;
          rows.push([tag(`IAQ-F${i}`), stuck ? "STUCK" : "OK", `${stuck ? 412 : Math.round(l.co2 + (i - 2) * 25)} ppm CO₂`, `${(l.roomTemp + (i - 2) * 0.2).toFixed(1)} °C · ${Math.round(52 + i)} %RH`]);
        }
      } else if (sysId === "supply") {
        rows.push([tag("Main incomer"), l.grid > 0 ? "ON" : "OFF", `${l.grid.toFixed(0)} kW`, `PF ${l.pf.toFixed(2)}`]);
        rows.push([tag("Solar inverter"), l.solar > 1 ? "ON" : "STANDBY", `${l.solar.toFixed(0)} kW`, `${b.solarKWp} kWp`]);
        rows.push([tag("DG-1"), l.dg > 0 ? "RUN" : "STOP", `${l.dg.toFixed(0)} kW`, "-"]);
      } else {
        rows.push([tag(DEMO.SYSTEMS.find((s) => s.id === sysId)?.name || sysId), "-", l.kw[sysId] != null ? `${l.kw[sysId].toFixed(1)} kW` : "-", "-"]);
      }
    }
    return rows;
  }

  function buildingRows(sim) {
    return DEMO.BUILDINGS.map((b) => {
      const t = totals(sim, b.id);
      return { b, ...t };
    });
  }

  /* Indian rupee format: Rs 1,92,410 / Rs 3.42 L / Rs 1.25 Cr */
  function inr(v, short) {
    if (v == null || isNaN(v)) return "-";
    if (short && v >= 1e7) return "₹" + (v / 1e7).toFixed(2) + " Cr";
    if (short && v >= 1e5) return "₹" + (v / 1e5).toFixed(2) + " L";
    return "₹" + fmt(v);
  }

  DEMO.kpi = { inr, buildingsIn, totals, series, systemSeries, systemKwh, heatmap, findings, faults, systemCards, equipment, buildingRows, curSlot, fmt };
})();
