/* =========================================================================
   simulator.js - generates dummy BMS readings, as if edge gateways in each
   building sent a batch every 15 minutes. One "tick" = 15 simulated minutes.
   In a real deployment this file is replaced by the live data feed
   (MQTT / API); the rest of the dashboard stays the same.
   ========================================================================= */

(function () {
  const STEP_MIN = 15;
  const STEP_MS = STEP_MIN * 60 * 1000;
  const SLOTS = 96;               // 15-minute slots per day
  const HOURS_PER_STEP = STEP_MIN / 60;

  /* ---------- small helpers ---------- */
  function rng(seed) {             // mulberry32: repeatable pseudo-random numbers
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ramp = (h, a, b, c, e) => (h <= a || h >= e) ? 0 : h < b ? (h - a) / (b - a) : h <= c ? 1 : (e - h) / (e - c);
  const bump = (h, mid, width) => Math.exp(-0.5 * Math.pow((h - mid) / width, 2));
  const round = (v, d = 1) => { const f = Math.pow(10, d); return Math.round(v * f) / f; };
  const hourOf = (t) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60; };
  const dowOf = (t) => new Date(t).getDay();
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

  /* ---------- the physical model ---------- */
  function occupancy(b, h, d) {
    if (b.type === "Office") {
      if (d >= 1 && d <= 5) return ramp(h, 7.25, 9.25, 18.25, 20.5);
      if (d === 6) return 0.45 * ramp(h, 8.5, 9.75, 13.5, 14.75);
      return 0;
    }
    if (b.type === "Hotel") {
      return clamp(0.5 + 0.3 * bump(h, 8, 1.8) + 0.4 * bump(h, 20.5, 2.4) - 0.25 * bump(h, 3, 2.2), 0.25, 1);
    }
    const weekend = d === 0 || d === 6;   // Mall
    return ramp(h, 9.5, 11, 21, 22.5) * (weekend ? 1 : 0.82);
  }

  function outdoorTemp(b, t, r) {
    const h = hourOf(t);
    const dayShift = Math.sin(startOfDay(t) / 86400000 * 1.7) * 0.8;
    const { tMin, tMax } = b.climate;
    return tMin + (tMax - tMin) * (0.5 + 0.5 * Math.sin(2 * Math.PI * (h - 9) / 24)) + dayShift + (r() - 0.5) * 0.6;
  }

  function plantScheduled(b, h, d) {
    if (b.type === "Hotel") return true;
    if (b.type === "Mall") return h >= 9 && h < 22.5;
    if (d >= 1 && d <= 5) return h >= 7 && h < 20;
    if (d === 6) return h >= 8.5 && h < 14.5;
    return false;
  }

  function wasteActive(w, h, d) { return w.active ? w.active(h, d) : true; }

  class Simulator {
    constructor(seed) {
      this.r = rng(seed || 20261009);
      this.buildings = DEMO.BUILDINGS;
      this.state = {};
      this.events = [];       // fault / waste / communication events (newest first)
      this.rawLog = [];       // raw BMS alarm & event log lines (newest first)
      this.scheduled = [];    // upcoming demo events
      this.listeners = [];
    }

    /* Build history for the past 6 days and today up to `now`. */
    init(now) {
      const t0 = Math.floor(now / STEP_MS) * STEP_MS;
      this.t = t0;
      this.dayStart = startOfDay(t0);
      this.simStart = t0;
      for (const b of this.buildings) this.state[b.id] = this.blankState(b);

      // past 6 days (history for the heatmap, yesterday comparison and waste totals)
      for (let day = 6; day >= 1; day--) {
        const ds = this.dayStart - day * 86400000;
        for (const b of this.buildings) {
          const st = this.state[b.id];
          const idx = 6 - day;
          let wasteCost = {};
          for (let s = 0; s < SLOTS; s++) {
            const t = ds + s * STEP_MS;
            const smp = this.sample(b, t);
            const kwh = smp.totalKw * HOURS_PER_STEP;
            st.hourly[idx][Math.floor(s / 4)] += kwh;
            st.dayTotals[idx] += kwh;
            this.addDay(st, idx, smp);
            for (const id in smp.waste) {
              wasteCost[id] = (wasteCost[id] || 0) + smp.waste[id] * HOURS_PER_STEP * DEMO.tariffAt(hourOf(t));
            }
            if (day === 1) st.yesterday[s] = smp.totalKw;
            st.meter += kwh;
          }
          st.wasteCostDays[idx] = wasteCost;
        }
      }
      // today, midnight -> now
      for (let t = this.dayStart; t <= t0; t += STEP_MS) {
        for (const b of this.buildings) this.apply(b, this.sample(b, t), t);
      }
      for (const b of this.buildings) this.state[b.id].lastTs = t0;

      // demo events, so something happens within the first minutes of the presentation
      this.scheduled = [
        { at: t0 + 3 * STEP_MS,  type: "gwOffline", building: "CSM", ticks: 5 },
        { at: t0 + 6 * STEP_MS,  type: "ahuTrip",   building: "GRH", ticks: 6 },
        { at: t0 + 10 * STEP_MS, type: "gridOut",   building: "GRH", ticks: 3 }
      ];
      // a data fault that is present from the start
      this.addEvent({
        building: "TPA", system: "iaq", category: "Data quality", severity: "warning",
        title: "CO2 sensor on floor 3 stuck at 412 ppm",
        detail: "IAQ-F3 has reported exactly 412 ppm for 31 hours. Ventilation decisions on floor 3 are running on a frozen value.",
        action: "Check or replace the IAQ-F3 sensor.",
        raw: "IAQ-F3 CO2 412 ppm", start: t0 - 31 * 3600000, kind: "fault"
      }, true);
      // some ordinary BMS chatter from the last few hours, for the raw event log
      for (let t = t0 - 3 * 3600000; t < t0; t += STEP_MS) {
        for (const b of this.buildings) this.routineRaw(b, this.sample(b, t), t + Math.floor(this.r() * 14) * 60000);
      }
      this.rawLog.sort((a, b) => b.t - a.t);
      this.raw(t0 - 4 * 60000, "TPA", "CH-1 RUN");
      this.raw(t0 - 9 * 60000, "GRH", "AHU-02 FILTER DP HI");
      this.rawLog.sort((a, b) => b.t - a.t);
    }

    blankState(b) {
      const sys = {};
      for (const s of DEMO.SYSTEMS) sys[s.id] = new Array(SLOTS).fill(null);
      return {
        series: sys,
        total: new Array(SLOTS).fill(null),
        efficient: new Array(SLOTS).fill(null),
        solar: new Array(SLOTS).fill(null),
        grid: new Array(SLOTS).fill(null),
        yesterday: new Array(SLOTS).fill(null),
        kwh: Object.fromEntries(DEMO.SYSTEMS.map((s) => [s.id, 0])),
        totalKwh: 0, gridKwh: 0, solarKwh: 0, dgKwh: 0, cost: 0, trh: 0,
        wasteKwh: {}, wasteCost: {},
        maxKva: 0,
        meter: b.meterStart,
        hourly: Array.from({ length: 7 }, () => new Array(24).fill(0)),
        dayTotals: new Array(7).fill(0),
        wasteCostDays: new Array(7).fill(null).map(() => ({})),
        /* per-day history for reports (index 6 = today) */
        sysDays: Array.from({ length: 7 }, () => Object.fromEntries(DEMO.SYSTEMS.map((s) => [s.id, 0]))),
        costDays: new Array(7).fill(0), trhDays: new Array(7).fill(0), solarDays: new Array(7).fill(0),
        maxKvaDays: new Array(7).fill(0), readingsDays: new Array(7).fill(0),
        last: null, lastTs: null,
        offline: false, buffer: [], offlineSince: null,
        ahuTrip: false, gridOut: false, dgRunMin: 0
      };
    }

    /* One 15-minute reading for one building. */
    sample(b, t) {
      const r = this.r;
      const h = hourOf(t), d = dowOf(t);
      const occ = occupancy(b, h, d);
      const tout = outdoorTemp(b, t, r);
      const st = this.state[b.id];
      const L = b.loads;
      const n = () => 1 + (r() - 0.5) * 0.06;          // +/-3% noise
      const kw = {};
      const waste = {};
      const W = DEMO.WASTE.filter((w) => w.building === b.id);
      const wOn = (id) => { const w = W.find((x) => x.id === id); return w && wasteActive(w, h, d); };

      /* chiller plant */
      const c = b.chiller;
      const capTR = c.units * c.unitTR;
      const afterHours = wOn("tpa-chiller-afterhours");
      const plantOn = plantScheduled(b, h, d) || afterHours;
      let tr = 0;
      if (plantOn) {
        const load = afterHours && !plantScheduled(b, h, d) ? c.base + 0.12 + c.tempW * (tout - 24) / 10
          : c.base + c.occW * occ + c.tempW * (tout - 24) / 10;
        tr = capTR * clamp(load, 0.06, 0.94) * n();
      }
      const kwtr = c.kwPerTR * (1 + (r() - 0.5) * 0.03);
      kw.chiller = tr * kwtr;
      const dT = tr > 0 ? c.dT + (r() - 0.5) * 0.3 : 0;
      const chws = 6.8 + (r() - 0.5) * 0.3;
      const flow = tr > 0 ? tr * 3.024 / dT : 0;
      const chillersOn = tr > 0 ? Math.ceil(tr / (c.unitTR * 0.92)) : 0;
      if (afterHours && !plantScheduled(b, h, d)) waste["tpa-chiller-afterhours"] = kw.chiller;
      else if (W.find((w) => w.id === "tpa-chiller-eff") && tr > 0) waste["tpa-chiller-eff"] = tr * (kwtr - DEMO.KPI_TARGETS.plantKwPerTR);

      /* air side */
      let air;
      if (b.type === "Office") air = plantScheduled(b, h, d) ? L.airside * (0.25 + 0.65 * occ) : 0;
      else if (b.type === "Hotel") air = L.airside * (0.55 + 0.35 * occ);
      else air = plantScheduled(b, h, d) ? L.airside * (0.3 + 0.6 * occ) : 0;
      air *= n();
      if (st && st.ahuTrip) air = Math.max(0, air - 15);
      kw.airside = air;

      /* lighting */
      let lig;
      if (b.type === "Office") lig = L.lighting * (0.1 + 0.85 * occ);
      else if (b.type === "Hotel") lig = L.lighting * (0.4 + 0.45 * bump(h, 20, 3.5) + 0.1 * occ);
      else lig = L.lighting * (0.06 + 0.9 * occ);
      kw.lighting = lig * n();

      /* ventilation */
      let ven;
      if (b.type === "Office") ven = L.vent * (plantScheduled(b, h, d) ? 0.35 + 0.55 * occ : 0.12);
      else if (b.type === "Hotel") ven = L.vent * (0.6 + 0.3 * occ);
      else ven = L.vent * (0.25 + 0.6 * occ);
      kw.vent = ven * n();

      /* vertical transport */
      kw.vertical = L.vertical * (b.type === "Hotel" ? 0.15 + 0.6 * occ : 0.05 + 0.95 * occ) * n();

      /* hot water */
      kw.hotwater = (b.type === "Hotel"
        ? L.hotwater * (0.25 + 0.6 * bump(h, 7.5, 1.5) + 0.5 * bump(h, 20, 2))
        : L.hotwater * (0.15 + 0.85 * occ)) * n();

      /* water pumping (pumps cycle on and off) */
      kw.water = L.water * (0.15 + 0.7 * occ) * (r() < 0.75 ? 1 : 0.35) * n();

      /* cold rooms */
      kw.cold = L.cold * (0.72 + 0.12 * Math.sin(t / 2.7e6)) * n();

      /* UPS losses */
      const upsOut = L.upsOut * (0.88 + 0.12 * occ);
      kw.ups = upsOut * (1 / L.upsEff - 1);

      /* STP / WTP */
      kw.plants = L.plants * (0.7 + 0.3 * occ) * n();

      /* kitchen, laundry, pool */
      if (b.type === "Office") kw.kitchen = (d >= 1 && d <= 5) ? L.kitchen * (0.08 + 0.45 * bump(h, 9, 0.9) + 0.9 * bump(h, 13, 1.2)) : L.kitchen * 0.05;
      else if (b.type === "Hotel") kw.kitchen = 90 * (0.2 + 0.7 * bump(h, 8, 1.4) + 0.8 * bump(h, 13, 1.3) + 0.9 * bump(h, 20.5, 1.8)) + 40 * ramp(h, 8, 9, 17, 18) + 20;
      else kw.kitchen = L.kitchen * (0.04 + occ * (0.6 + 0.4 * bump(h, 13.5, 1.5) + 0.5 * bump(h, 20, 1.5)));
      kw.kitchen *= n();

      /* sockets, IT, tenants */
      kw.plug = L.plug * (b.type === "Hotel" ? 0.55 + 0.3 * occ : 0.15 + 0.85 * occ) * n();

      /* planted problems that add load */
      for (const w of W) {
        if (!w.kw || !wasteActive(w, h, d) || w.kind === "schedule") continue;
        if (w.id === "tpa-ups-low") { waste[w.id] = w.kw; continue; }   // part of the existing UPS loss
        kw[w.system] += w.kw * n();
        waste[w.id] = w.kw;
      }

      let totalKw = 0;
      for (const s of DEMO.SYSTEMS) totalKw += kw[s.id];
      let wasteKw = 0;
      for (const id in waste) wasteKw += waste[id];

      /* supply side */
      const cloud = 0.78 + 0.22 * Math.sin(startOfDay(t) / 86400000 * 2.3 + h / 3);
      const solar = b.solarKWp * Math.pow(Math.max(0, Math.sin(Math.PI * (h - 6.2) / 12.4)), 1.3) * cloud * (0.96 + r() * 0.04);
      const gridOut = st && st.gridOut;
      const dg = gridOut ? Math.max(0, totalKw - solar) : 0;
      const grid = gridOut ? 0 : Math.max(0, totalKw - solar);
      const pf = clamp(0.94 + 0.04 * occ + (r() - 0.5) * 0.01, 0.9, 0.99);

      return {
        t, h, d, occ, tout, kw, totalKw, wasteKw, waste, solar, grid, dg, pf,
        tr, kwtr, dT, chws, chwr: chws + dT, flow, chillersOn, upsOut,
        coldTemp: 3.2 + (wOn("grh-coldroom-door") ? 4.5 : 0) + (r() - 0.5) * 0.6,
        doorOpen: !!wOn("grh-coldroom-door"),
        co2: 430 + 520 * occ + (r() - 0.5) * 40,
        carParkCO: b.type === "Mall" ? (occ > 0.1 ? 8 + 10 * occ : 3 + r() * 2) : null,
        roomTemp: 23.2 + 1.4 * occ + (r() - 0.5) * 0.4 + (st && st.ahuTrip ? 3.1 : 0)
      };
    }

    /* Store one reading in the building's day series and running totals. */
    apply(b, smp, t) {
      const st = this.state[b.id];
      if (t - this.dayStart >= 86400000) return;
      const slot = Math.floor((t - this.dayStart) / STEP_MS);
      const tariff = DEMO.tariffAt(smp.h);
      for (const s of DEMO.SYSTEMS) {
        st.series[s.id][slot] = smp.kw[s.id];
        st.kwh[s.id] += smp.kw[s.id] * HOURS_PER_STEP;
      }
      st.total[slot] = smp.totalKw;
      st.efficient[slot] = smp.totalKw - smp.wasteKw;
      st.solar[slot] = smp.solar;
      st.grid[slot] = smp.grid + smp.dg;
      const kwh = smp.totalKw * HOURS_PER_STEP;
      st.totalKwh += kwh;
      st.trh += smp.tr * HOURS_PER_STEP;
      st.gridKwh += smp.grid * HOURS_PER_STEP;
      st.solarKwh += Math.min(smp.solar, smp.totalKw) * HOURS_PER_STEP;
      st.dgKwh += smp.dg * HOURS_PER_STEP;
      st.cost += smp.grid * HOURS_PER_STEP * tariff + smp.dg * HOURS_PER_STEP * DEMO.TARIFF.diesel;
      st.hourly[6][Math.floor(slot / 4)] += kwh;
      st.dayTotals[6] += kwh;
      st.meter += smp.grid * HOURS_PER_STEP;
      st.maxKva = Math.max(st.maxKva, (smp.grid + smp.dg) / smp.pf);
      for (const id in smp.waste) {
        st.wasteKwh[id] = (st.wasteKwh[id] || 0) + smp.waste[id] * HOURS_PER_STEP;
        st.wasteCost[id] = (st.wasteCost[id] || 0) + smp.waste[id] * HOURS_PER_STEP * tariff;
      }
      st.wasteCostDays[6] = st.wasteCost;
      this.addDay(st, 6, smp);
      if (smp.dg > 0) st.dgRunMin += STEP_MIN;
      st.last = smp;
    }

    addDay(st, idx, smp) {
      for (const s of DEMO.SYSTEMS) st.sysDays[idx][s.id] += smp.kw[s.id] * HOURS_PER_STEP;
      st.costDays[idx] += smp.grid * HOURS_PER_STEP * DEMO.tariffAt(smp.h) + smp.dg * HOURS_PER_STEP * DEMO.TARIFF.diesel;
      st.trhDays[idx] += smp.tr * HOURS_PER_STEP;
      st.solarDays[idx] += Math.min(smp.solar, smp.totalKw) * HOURS_PER_STEP;
      st.maxKvaDays[idx] = Math.max(st.maxKvaDays[idx], (smp.grid + smp.dg) / smp.pf);
      st.readingsDays[idx] += 1;
    }

    newDay() {
      this.dayStart += 86400000;
      for (const b of this.buildings) {
        const st = this.state[b.id];
        st.yesterday = st.total.slice();
        for (const k of ["total", "efficient", "solar", "grid"]) st[k] = new Array(SLOTS).fill(null);
        for (const s of DEMO.SYSTEMS) { st.series[s.id] = new Array(SLOTS).fill(null); st.kwh[s.id] = 0; }
        st.totalKwh = st.gridKwh = st.solarKwh = st.dgKwh = st.cost = st.maxKva = st.dgRunMin = st.trh = 0;
        st.wasteKwh = {}; st.wasteCost = {};
        st.hourly.shift(); st.hourly.push(new Array(24).fill(0));
        st.dayTotals.shift(); st.dayTotals.push(0);
        st.wasteCostDays.shift(); st.wasteCostDays.push({});
        st.sysDays.shift(); st.sysDays.push(Object.fromEntries(DEMO.SYSTEMS.map((s) => [s.id, 0])));
        for (const k of ["costDays", "trhDays", "solarDays", "maxKvaDays", "readingsDays"]) { st[k].shift(); st[k].push(0); }
      }
    }

    /* Advance the simulation by one 15-minute step. */
    step() {
      this.t += STEP_MS;
      const t = this.t;
      if (t - this.dayStart >= 86400000) this.newDay();
      this.runEvents(t);
      for (const b of this.buildings) {
        const st = this.state[b.id];
        const smp = this.sample(b, t);
        if (st.offline) { st.buffer.push({ smp, t }); continue; }
        this.apply(b, smp, t);
        st.lastTs = t;
        this.routineRaw(b, smp, t);
      }
      this.listeners.forEach((fn) => fn());
    }

    runEvents(t) {
      // random events after the scripted ones
      if (this.scheduled.length === 0 && this.r() < 0.05) {
        const types = ["gwOffline", "ahuTrip", "gridOut"];
        const type = types[Math.floor(this.r() * types.length)];
        const b = this.buildings[Math.floor(this.r() * this.buildings.length)];
        this.scheduled.push({ at: t + STEP_MS * (2 + Math.floor(this.r() * 6)), type, building: b.id, ticks: 3 + Math.floor(this.r() * 4) });
      }
      const due = this.scheduled.filter((e) => e.at <= t);
      this.scheduled = this.scheduled.filter((e) => e.at > t);
      for (const e of due) this.startEvent(e, t);

      for (const ev of this.events) {
        if (ev.status === "resolved" || !ev.endsAt || ev.endsAt > t) continue;
        this.endEvent(ev, t);
      }
    }

    startEvent(e, t) {
      const b = this.buildings.find((x) => x.id === e.building);
      const st = this.state[b.id];
      const endsAt = t + e.ticks * STEP_MS;
      if (e.type === "gwOffline" && !st.offline) {
        st.offline = true; st.offlineSince = t;
        this.addEvent({ building: b.id, system: "comms", category: "Communication", severity: "critical",
          title: `Gateway offline at ${b.name}`, detail: "No readings received from the edge gateway. Values shown for this building are the last ones received.",
          action: "Check the gateway's internet link and power. Readings are buffered on the gateway and will be sent when it reconnects.",
          raw: `GW-${b.id}-01 COMM FAIL`, start: t, endsAt, kind: "fault", ref: "gw" });
      } else if (e.type === "ahuTrip" && !st.ahuTrip) {
        st.ahuTrip = true;
        this.addEvent({ building: b.id, system: "airside", category: "Equipment", severity: "warning",
          title: "AHU-03 tripped", detail: "AHU-03 (ballroom and pre-function area) stopped on a motor overload. Zone temperature is rising.",
          action: "Inspect the AHU-03 fan motor and overload relay, then restart.",
          raw: "AHU-03 TRIP DI=1", start: t, endsAt, kind: "fault", ref: "ahu" });
      } else if (e.type === "gridOut" && !st.gridOut) {
        st.gridOut = true;
        this.addEvent({ building: b.id, system: "power", category: "Power", severity: "warning",
          title: `Grid outage, DG-1 running at ${b.name}`, detail: `Diesel power costs about ₹${DEMO.TARIFF.diesel}/kWh, roughly 3x grid power.`,
          action: "No action needed if the outage is short. Track DG fuel and run hours.",
          raw: "MAINS FAIL / DG-1 RUN", start: t, endsAt, kind: "fault", ref: "dg" });
      }
    }

    endEvent(ev, t) {
      const b = this.buildings.find((x) => x.id === ev.building);
      const st = this.state[b.id];
      ev.status = "resolved"; ev.end = t;
      if (ev.ref === "gw") {
        const n = st.buffer.length;
        for (const { smp, t: ts } of st.buffer) { if (ts - this.dayStart >= 0) this.apply(b, smp, ts); }
        st.buffer = []; st.offline = false; st.lastTs = t;
        this.raw(t, b.id, `GW-${b.id}-01 COMM OK`);
        this.addEvent({ building: b.id, system: "comms", category: "Communication", severity: "info",
          title: `Gateway back online at ${b.name}`, detail: `${n} buffered readings received and filled in (store-and-forward), so no data was lost.`,
          raw: `GW-${b.id}-01 BUFFER ${n} RECORDS`, start: t, end: t, kind: "info", status: "resolved" });
      } else if (ev.ref === "ahu") {
        st.ahuTrip = false; this.raw(t, b.id, "AHU-03 RUN");
      } else if (ev.ref === "dg") {
        st.gridOut = false; this.raw(t, b.id, "MAINS OK / DG-1 STOP");
      }
    }

    addEvent(ev, silentRaw) {
      ev.id = "ev" + Math.floor(this.r() * 1e9);
      ev.status = ev.status || "open";
      this.events.unshift(ev);
      if (!silentRaw && ev.raw) this.raw(ev.start, ev.building, ev.raw);
      if (this.events.length > 60) this.events.pop();
    }

    raw(t, bid, text) {
      this.rawLog.unshift({ t, building: bid, text });
      if (this.rawLog.length > 80) this.rawLog.pop();
    }

    routineRaw(b, smp, t) {   // ordinary BMS chatter, for the raw event log
      const r = this.r();
      if (r < 0.08) this.raw(t, b.id, `CH-${1 + Math.floor(this.r() * b.chiller.units)} ${smp.tr > 0 ? "RUN" : "STOP"}`);
      else if (r < 0.14) this.raw(t, b.id, `AHU-0${1 + Math.floor(this.r() * 8)} ${smp.occ > 0.1 ? "START" : "STOP"}`);
      else if (r < 0.18) this.raw(t, b.id, `LTG-Z${1 + Math.floor(this.r() * 9)} ${smp.occ > 0.1 ? "ON" : "OFF"}`);
      else if (r < 0.2) this.raw(t, b.id, `PMP-0${1 + Math.floor(this.r() * 3)} ${this.r() < 0.5 ? "RUN" : "STOP"}`);
    }

    onUpdate(fn) { this.listeners.push(fn); }
  }

  DEMO.Simulator = Simulator;
  DEMO.STEP_MS = STEP_MS;
  DEMO.SLOTS = SLOTS;
  DEMO.util = { clamp, round, hourOf, dowOf, startOfDay };
})();
