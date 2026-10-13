/* =========================================================================
   report.js - the report engine.
   1. Collects the numbers for a period (today / yesterday / last 7 days).
   2. Builds one "report model": a title block plus numbered sections, each
      with a short text and a table.
   3. Draws that same model twice: as an on-screen preview (HTML) and as an
      A4 PDF (pdf-lib), so what you preview is what you download.
   In the real product the same model would be built on the server from
   the database; only the data source changes.
   ========================================================================= */

(function () {
  const K = () => DEMO.kpi;
  const fmt = (v, d) => DEMO.kpi.fmt(v, d);
  const inr = (v) => DEMO.kpi.inr(v);
  const inrS = (v) => DEMO.kpi.inr(v, true);
  const pctF = (v, d = 1) => (v == null || isNaN(v) ? "-" : fmt(v * 100, d) + "%");
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const DAY = 86400000;
  const sysName = (id) => (DEMO.SYSTEMS.find((s) => s.id === id) || { name: id }).name;
  const bById = (id) => DEMO.BUILDINGS.find((b) => b.id === id);

  const dFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const dShort = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short" });
  const tFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dtFmt = (t) => `${dFmt.format(new Date(t))}, ${tFmt.format(new Date(t))}`;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
    return `${Math.floor(h / 24)} d ${h % 24} h`;
  }

  /* ---------------------------------------------------------------------
     What the user can pick
     --------------------------------------------------------------------- */
  const TYPES = [
    { id: "portfolio",  name: "Portfolio",  desc: "All or selected buildings, combined" },
    { id: "building",   name: "Building",   desc: "One building in detail" },
    { id: "system",     name: "System",     desc: "One system in one building" },
    { id: "comparison", name: "Comparison", desc: "2 or 3 buildings side by side" }
  ];
  const PERIODS = [
    { id: "today", name: "Today" },
    { id: "yesterday", name: "Yesterday" },
    { id: "week", name: "Last 7 days" }
  ];
  /* sections per report type, in print order */
  const SECTIONS = {
    portfolio: [["summary", "Executive summary"], ["buildings", "Building comparison"], ["systems", "Energy by system"], ["savings", "Savings opportunities"], ["faults", "Faults and alarms"], ["quality", "Data quality"], ["signoff", "Sign-off"]],
    building:  [["summary", "Executive summary"], ["daily", "Daily energy"], ["systems", "Energy by system"], ["savings", "Savings opportunities"], ["faults", "Faults and alarms"], ["quality", "Data quality"], ["signoff", "Sign-off"]],
    system:    [["summary", "System summary"], ["daily", "Daily energy"], ["equipment", "Equipment status"], ["savings", "Savings opportunities"], ["faults", "Faults and alarms"], ["signoff", "Sign-off"]],
    comparison:[["summary", "Key figures side by side"], ["systems", "Energy by system"], ["daily", "Daily energy"], ["savings", "Savings opportunities"], ["quality", "Data quality"], ["signoff", "Sign-off"]]
  };

  /* ---------------------------------------------------------------------
     Period: which day slots of the history to add up
     --------------------------------------------------------------------- */
  function period(sim, id) {
    const slot = K().curSlot(sim);
    const today = sim.dayStart;
    const now = tFmt.format(new Date(sim.t));
    if (id === "yesterday") {
      return { id, idxs: [5], start: today - DAY, end: today - 1, expected: DEMO.SLOTS,
        label: `Yesterday, ${dFmt.format(new Date(today - DAY))} (full day)`, short: "Yesterday" };
    }
    if (id === "week") {
      return { id, idxs: [0, 1, 2, 3, 4, 5, 6], start: today - 6 * DAY, end: sim.t, expected: 6 * DEMO.SLOTS + slot + 1,
        label: `Last 7 days, ${dShort.format(new Date(today - 6 * DAY))} to ${dFmt.format(new Date(today))} (up to ${now})`, short: "Last 7 days" };
    }
    return { id: "today", idxs: [6], start: today, end: sim.t, expected: slot + 1,
      label: `Today, ${dFmt.format(new Date(today))} (00:00 to ${now})`, short: "Today" };
  }
  const dayLabel = (sim, idx) => dShort.format(new Date(sim.dayStart - (6 - idx) * DAY)) + (idx === 6 ? " (today, to " + tFmt.format(new Date(sim.t)) + ")" : "");

  /* ---------------------------------------------------------------------
     Numbers for one building over the period
     --------------------------------------------------------------------- */
  function faultsIn(sim, bids, P, sysId) {
    return sim.events.filter((e) => e.kind === "fault" && bids.includes(e.building) && e.start <= P.end &&
      (!e.end || e.end >= P.start) && (!sysId || e.system === sysId))
      .sort((a, b) => a.start - b.start);
  }

  function bstats(sim, b, P) {
    const st = sim.state[b.id];
    const sys = {};
    for (const s of DEMO.SYSTEMS) sys[s.id] = sum(P.idxs.map((i) => st.sysDays[i][s.id]));
    const kwh = sum(Object.values(sys));
    const cost = sum(P.idxs.map((i) => st.costDays[i]));
    const trh = sum(P.idxs.map((i) => st.trhDays[i]));
    const solar = sum(P.idxs.map((i) => st.solarDays[i]));
    const maxKva = Math.max(...P.idxs.map((i) => st.maxKvaDays[i]));
    const readings = sum(P.idxs.map((i) => st.readingsDays[i]));
    const findings = K().findings(sim, b.id).map((f) => ({ ...f, costPeriod: sum(P.idxs.map((i) => (st.wasteCostDays[i] || {})[f.id] || 0)) }));
    const faults = faultsIn(sim, [b.id], P);
    const gwEvents = faults.filter((e) => e.ref === "gw");
    return {
      b, sys, kwh, cost, trh, solar, maxKva, readings, expected: P.expected,
      completeness: P.expected ? Math.min(1, readings / P.expected) : 1,
      buffered: st.buffer.length, offline: st.offline, gwEvents,
      area: b.areaM2, kwhM2: kwh / b.areaM2,
      eui: readings ? kwh / readings * DEMO.SLOTS * 365 / b.areaM2 : null,
      kwPerTR: trh >= 1 ? sys.chiller / trh : null,
      upsOut: sys.ups * b.loads.upsEff / (1 - b.loads.upsEff),
      avoid: sum(findings.map((f) => f.costPeriod)),
      savingsMonth: sum(findings.map((f) => f.costMonth)),
      findings, faults,
      openFaults: faults.filter((e) => e.status !== "resolved").length
    };
  }

  /* Add several buildings together (portfolio). Peak kVA is the sum of each building's peak. */
  function combine(list) {
    const sys = {};
    for (const s of DEMO.SYSTEMS) sys[s.id] = sum(list.map((x) => x.sys[s.id]));
    const t = (k) => sum(list.map((x) => x[k]));
    const trh = t("trh"), area = t("area"), readings = t("readings"), expected = t("expected");
    return {
      sys, kwh: t("kwh"), cost: t("cost"), trh, solar: t("solar"), maxKva: t("maxKva"), readings, expected, area,
      completeness: expected ? Math.min(1, readings / expected) : 1,
      kwhM2: t("kwh") / area,
      eui: readings ? t("kwh") / readings * DEMO.SLOTS * 365 / area * list.length : null,
      kwPerTR: trh >= 1 ? sys.chiller / trh : null,
      upsOut: t("upsOut"), avoid: t("avoid"), savingsMonth: t("savingsMonth"),
      findings: list.flatMap((x) => x.findings).sort((a, b) => b.costMonth - a.costMonth),
      faults: list.flatMap((x) => x.faults).sort((a, b) => a.start - b.start),
      openFaults: t("openFaults")
    };
  }

  /* ---------------------------------------------------------------------
     Small table helpers. A cell is a string or { t, tone, b }.
     tone: "good" | "warning" | "critical"; b: bold.
     --------------------------------------------------------------------- */
  const C = (t, tone, b) => ({ t: String(t), tone, b });
  const col = (h, w, align) => ({ h, w, align: align || "l" });
  const SEV = { critical: "Critical", warning: "Warning", info: "Info" };
  const sevCell = (s) => C(SEV[s] || s, s === "info" ? null : s);
  const STATUS = { open: "Open", acknowledged: "Acknowledged", resolved: "Resolved" };

  function sysStatus(findings, faults, sysId) {
    const fs = findings.filter((f) => f.system === sysId && (f.costPeriod > 0 || f.costMonth > 0 || f.activeNow));
    const openFault = faults.some((e) => e.system === sysId && e.status !== "resolved");
    if (openFault || fs.some((f) => f.severity === "critical")) return C("Action needed", "critical");
    if (fs.length) return C("Review", "warning");
    return C("Within target", "good");
  }

  function sysKpi(x, sysId, avoid) {
    if (sysId === "chiller") {
      if (x.kwPerTR == null) return ["Not running in period", "<= 0.65 kW/TR"];
      return [C(`${fmt(x.kwPerTR, 2)} kW/TR`, x.kwPerTR <= 0.70 ? "good" : x.kwPerTR <= 0.80 ? "warning" : "critical"), "<= 0.65 kW/TR"];
    }
    if (sysId === "ups") {
      const eff = x.upsOut / (x.upsOut + x.sys.ups);
      return [C(`${fmt(eff * 100, 1)}% efficiency`, eff >= DEMO.KPI_TARGETS.upsEff ? "good" : "warning"), `>= ${DEMO.KPI_TARGETS.upsEff * 100}%`];
    }
    return [avoid > 0 ? C(`${inr(avoid)} avoidable`, "warning") : "No waste found", "Zero waste"];
  }

  function systemsTable(x) {
    const rows = [];
    const ranked = DEMO.SYSTEMS.filter((s) => x.sys[s.id] > 0.5).sort((a, b) => x.sys[b.id] - x.sys[a.id]);
    for (const s of ranked) {
      const avoid = sum(x.findings.filter((f) => f.system === s.id).map((f) => f.costPeriod));
      const [kpi, target] = sysKpi(x, s.id, avoid);
      rows.push([s.name, fmt(x.sys[s.id]), pctF(x.sys[s.id] / x.kwh), inr(x.cost * x.sys[s.id] / x.kwh), kpi, target, sysStatus(x.findings, x.faults, s.id)]);
    }
    rows.push([C("Total", null, true), C(fmt(x.kwh), null, true), C("100%", null, true), C(inr(x.cost), null, true), "", "", ""]);
    return {
      cols: [col("System", 0.2), col("Energy (kWh)", 0.11, "r"), col("Share", 0.07, "r"), col("Cost est. (Rs)", 0.12, "r"), col("Key indicator", 0.2), col("Target", 0.14), col("Status", 0.16)],
      rows
    };
  }

  function savingsTable(findings, showBuilding, P) {
    const list = findings.filter((f) => f.costMonth > 0 || f.costPeriod > 0);
    if (!list.length) return null;
    const rows = list.map((f, i) => [String(i + 1), C(f.title, null, true), ...(showBuilding ? [f.building.id] : []), sysName(f.system), sevCell(f.severity), inr(f.costPeriod), inr(f.costMonth), f.action]);
    rows.push(["", C("Total", null, true), ...(showBuilding ? [""] : []), "", "", C(inr(sum(list.map((f) => f.costPeriod))), null, true), C(inr(sum(list.map((f) => f.costMonth))), null, true), ""]);
    const cols = [col("#", 0.04, "r"), col("Finding", showBuilding ? 0.24 : 0.28), ...(showBuilding ? [col("Bldg", 0.06)] : []), col("System", 0.12), col("Severity", 0.09),
      col(`Cost, ${P.short.toLowerCase()} (Rs)`, 0.1, "r"), col("Rs / month (est.)", 0.1, "r"), col("Recommended action", showBuilding ? 0.25 : 0.27)];
    return { cols, rows };
  }

  function faultsTable(sim, faults, showBuilding) {
    if (!faults.length) return null;
    return {
      cols: [col("Fault / alarm", showBuilding ? 0.3 : 0.36), col("Severity", 0.1), ...(showBuilding ? [col("Bldg", 0.06)] : []), col("Started", 0.17), col("Duration", 0.11), col("Status", 0.13), col("Acknowledged by", 0.13)],
      rows: faults.map((e) => [e.title, sevCell(e.severity), ...(showBuilding ? [e.building] : []), dtFmt(e.start), dur((e.end || sim.t) - e.start),
        C(STATUS[e.status] || e.status, e.status === "resolved" ? "good" : e.status === "acknowledged" ? "warning" : "critical"), e.ackBy || "-"])
    };
  }

  function qualityTable(list) {
    return {
      cols: [col("Building", 0.24), col("Gateway", 0.12), col("Readings received", 0.13, "r"), col("Expected", 0.1, "r"), col("Completeness", 0.12, "r"), col("Gaps / notes", 0.29)],
      rows: list.map((x) => {
        const notes = [];
        if (x.gwEvents.length) notes.push(`${x.gwEvents.length} gateway outage${x.gwEvents.length > 1 ? "s" : ""}`);
        if (x.buffered) notes.push(`${x.buffered} readings held on gateway, will fill in on reconnect`);
        const iaq = x.faults.find((e) => e.category === "Data quality");
        if (iaq) notes.push("Stuck sensor: " + iaq.title);
        return [x.b.name, C(x.offline ? "Offline" : "Online", x.offline ? "critical" : "good"), fmt(x.readings), fmt(x.expected),
          C(pctF(x.completeness), x.completeness >= 0.99 ? "good" : x.completeness >= 0.95 ? "warning" : "critical"), notes.join("; ") || "No gaps"];
      })
    };
  }

  function dailyTable(sim, P, list, sysId) {
    const idxs = P.idxs;
    const one = list.length === 1;
    const val = (x, i) => (sysId ? x.b && sim.state[x.b.id].sysDays[i][sysId] : sum(Object.values(sim.state[x.b.id].sysDays[i])));
    const cols = [col("Day", one ? 0.34 : 0.28)];
    if (one) {
      cols.push(col(sysId ? "System energy (kWh)" : "Energy (kWh)", 0.22, "r"), col(sysId ? "Share of building" : "Cost (Rs)", 0.22, "r"), col(sysId ? "Cost est. (Rs)" : "Peak demand (kVA)", 0.22, "r"));
    } else {
      for (const x of list) cols.push(col(`${x.b.id} (kWh)`, 0.72 / list.length, "r"));
    }
    const rows = idxs.map((i) => {
      if (one) {
        const x = list[0], st = sim.state[x.b.id];
        const bk = sum(Object.values(st.sysDays[i]));
        const v = val(x, i);
        return sysId ? [dayLabel(sim, i), fmt(v), pctF(bk ? v / bk : 0), inr(bk ? st.costDays[i] * v / bk : 0)]
                     : [dayLabel(sim, i), fmt(v), inr(st.costDays[i]), fmt(st.maxKvaDays[i])];
      }
      return [dayLabel(sim, i), ...list.map((x) => fmt(val(x, i)))];
    });
    if (idxs.length > 1) {
      if (one) {
        const x = list[0], st = sim.state[x.b.id];
        const tot = sum(idxs.map((i) => val(x, i)));
        const bk = sum(idxs.map((i) => sum(Object.values(st.sysDays[i]))));
        const cost = sum(idxs.map((i) => st.costDays[i]));
        rows.push(sysId ? [C("Total", null, true), C(fmt(tot), null, true), C(pctF(tot / bk), null, true), C(inr(cost * tot / bk), null, true)]
                        : [C("Total", null, true), C(fmt(tot), null, true), C(inr(cost), null, true), C(fmt(Math.max(...idxs.map((i) => st.maxKvaDays[i]))) + " max", null, true)]);
      } else {
        rows.push([C("Total", null, true), ...list.map((x) => C(fmt(sum(idxs.map((i) => val(x, i)))), null, true))]);
      }
    }
    return { cols, rows };
  }

  /* Metric rows x building columns, best value green, worst red. */
  function compareTable(list, metrics) {
    const cols = [col("Metric", 0.28)];
    for (const x of list) cols.push(col(x.b.name, 0.72 / list.length, "r"));
    const rows = metrics.map(([label, get, show, better]) => {
      const vals = list.map((x) => get(x));
      if (vals.some((v) => typeof v === "string")) return [C(label, null, true), ...vals.map((v) => show(v))];
      const nums = vals.filter((v) => v != null && !isNaN(v));
      const best = better === "low" ? Math.min(...nums) : Math.max(...nums);
      const worst = better === "low" ? Math.max(...nums) : Math.min(...nums);
      const differs = better && nums.length > 1 && best !== worst;
      return [C(label, null, true), ...vals.map((v) => {
        const t = v == null || isNaN(v) ? "-" : show(v);
        if (!differs || v == null) return t;
        return v === best ? C(t, "good") : v === worst ? C(t, "critical") : t;
      })];
    });
    return { cols, rows };
  }

  function signoff(user, at) {
    return {
      cols: [col("", 0.2), col("Name", 0.28), col("Designation", 0.2), col("Signature", 0.18), col("Date", 0.14)],
      rows: [[C("Prepared by", null, true), user.name, user.role, "", dFmt.format(new Date(at))],
             [C("Reviewed by", null, true), "", "", "", ""],
             [C("Approved by", null, true), "", "", "", ""]],
      tall: true
    };
  }

  /* ---------------------------------------------------------------------
     Build the report model
     --------------------------------------------------------------------- */
  const CODE = { portfolio: "PF", building: "BL", system: "SY", comparison: "CM" };

  function build(sim, opts, user) {
    const P = period(sim, opts.period);
    const want = (k) => opts.sections.includes(k);
    const secs = [];
    const add = (key, title, intro, body) => { if (want(key)) secs.push({ key, title, intro, ...body }); };
    let title, scope, scopeShort;

    if (opts.type === "portfolio" || opts.type === "building") {
      const ids = opts.type === "building" ? [opts.building] : opts.buildings;
      const list = ids.map((id) => bstats(sim, bById(id), P));
      const x = list.length === 1 ? list[0] : combine(list);
      const many = list.length > 1;
      const all = many && ids.length === DEMO.BUILDINGS.length;
      if (opts.type === "portfolio") {
        title = "Portfolio Energy Performance Report";
        scope = all ? `Overall portfolio - all ${list.length} buildings (${list.map((s) => s.b.name).join(", ")})` : `Portfolio - ${list.length} selected building${many ? "s" : ""}: ${list.map((s) => s.b.name).join(", ")}`;
        scopeShort = all ? "All-buildings" : ids.join("-");
      } else {
        const b = list[0].b;
        title = "Building Energy Performance Report";
        scope = `${b.name} (${b.id}) - ${b.type}, ${b.city}, ${fmt(b.areaM2)} m²`;
        scopeShort = b.id;
      }

      /* summary */
      const top = x.findings[0];
      const chillerShare = x.sys.chiller / x.kwh;
      const paras = [
        `${many ? "The " + list.length + " buildings" : list[0].b.name} used ${fmt(x.kwh)} kWh of electricity in the period (${P.short.toLowerCase()}), at an energy cost of ${inr(x.cost)}. The chiller plant was the largest consumer at ${pctF(chillerShare, 0)} of the total${x.kwPerTR != null ? `, running at ${fmt(x.kwPerTR, 2)} kW/TR against a target of 0.65` : ""}.`,
        x.findings.length ? `${x.findings.length} savings opportunit${x.findings.length > 1 ? "ies were" : "y was"} found, worth about ${inrS(x.savingsMonth)} per month. The largest is "${top.title}" at ${top.building.name} (${inrS(top.costMonth)} per month).` : "No savings opportunities were found in the period.",
        `${x.faults.length} fault${x.faults.length === 1 ? "" : "s"} occurred in the period; ${x.openFaults} ${x.openFaults === 1 ? "is" : "are"} still open. Data completeness was ${pctF(x.completeness)}.`
      ];
      add("summary", "Executive summary", null, {
        paras,
        table: {
          cols: [col("Metric", 0.4), col("Value", 0.28, "r"), col("Reference / target", 0.32)],
          rows: [
            ["Buildings in scope", String(list.length), list.map((s) => s.b.id).join(", ")],
            ["Total floor area", `${fmt(x.area)} m²`, ""],
            [C("Energy consumed", null, true), C(`${fmt(x.kwh)} kWh`, null, true), P.short],
            [C("Energy cost", null, true), C(inr(x.cost), null, true), "Grid at time-of-day tariff, DG at Rs 28/kWh"],
            ["Energy intensity", `${fmt(x.kwhM2, x.kwhM2 < 1 ? 3 : 2)} kWh/m²`, "For the period"],
            ["Energy use intensity (annualised)", `${fmt(x.eui)} kWh/m²/yr`, "Benchmark depends on building type"],
            ["Peak demand", `${fmt(x.maxKva)} kVA`, many ? "Sum of each building's peak" : "Highest 15-minute demand"],
            ["Solar energy used", `${fmt(x.solar)} kWh`, `${pctF(x.solar / x.kwh)} of consumption`],
            ["Chiller plant efficiency", x.kwPerTR != null ? C(`${fmt(x.kwPerTR, 2)} kW/TR`, x.kwPerTR <= 0.7 ? "good" : x.kwPerTR <= 0.8 ? "warning" : "critical") : "Not running", "Target <= 0.65 kW/TR"],
            ["Avoidable cost in period", C(inr(x.avoid), x.avoid > 0 ? "warning" : "good"), "Energy used with no need, at tariff"],
            [C("Savings opportunities", null, true), C(`${inr(x.savingsMonth)} / month`, x.savingsMonth > 0 ? "warning" : "good", true), `${x.findings.length} finding${x.findings.length === 1 ? "" : "s"}, see section on savings`],
            ["Faults in period", C(`${x.faults.length} (${x.openFaults} open)`, x.openFaults ? "critical" : "good"), ""],
            ["Data completeness", C(pctF(x.completeness), x.completeness >= 0.99 ? "good" : x.completeness >= 0.95 ? "warning" : "critical"), `${fmt(x.readings)} of ${fmt(x.expected)} readings received`]
          ]
        }
      });
      if (opts.type === "portfolio") {
        add("buildings", "Building comparison", "Each building's figures for the period. Best value in green, weakest in red.", {
          table: compareTable(list, compareMetrics())
        });
      }
      if (opts.type === "building") {
        add("daily", "Daily energy", "Energy, cost and peak demand for each day in the period.", { table: dailyTable(sim, P, list) });
      }
      add("systems", "Energy by system", "Energy for each system, ranked. Cost is the building cost shared in proportion to energy.", { table: systemsTable(x) });
      const sv = savingsTable(x.findings, many, P);
      add("savings", "Savings opportunities", "Waste found in the readings, ranked by estimated cost per month (based on the last 6 full days).", sv ? { table: sv } : { paras: ["No savings opportunities were found."] });
      const ft = faultsTable(sim, x.faults, many);
      add("faults", "Faults and alarms", "Faults that were active at any time in the period.", ft ? { table: ft } : { paras: ["No faults in the period."] });
      add("quality", "Data quality", "Readings are expected every 15 minutes from each building's gateway.", { table: qualityTable(list) });
    }

    else if (opts.type === "system") {
      const b = bById(opts.building), s = DEMO.SYSTEMS.find((q) => q.id === opts.system);
      const x = bstats(sim, b, P);
      const fs = x.findings.filter((f) => f.system === s.id);
      const faults = x.faults.filter((e) => e.system === s.id);
      title = "System Energy Performance Report";
      scope = `${s.name} - ${b.name} (${b.id}), ${b.city}`;
      scopeShort = `${b.id}-${s.id}`;
      const kwh = x.sys[s.id], avoid = sum(fs.map((f) => f.costPeriod)), month = sum(fs.map((f) => f.costMonth));
      const [kpi, target] = sysKpi({ ...x, findings: fs }, s.id, avoid);
      add("summary", "System summary", null, {
        paras: [`${s.name} at ${b.name} used ${fmt(kwh)} kWh in the period (${P.short.toLowerCase()}), ${pctF(kwh / x.kwh)} of the building's energy, at an estimated cost of ${inr(x.cost * kwh / x.kwh)}. ${fs.length ? `${fs.length} savings opportunit${fs.length > 1 ? "ies" : "y"} worth about ${inrS(month)} per month ${fs.length > 1 ? "were" : "was"} found.` : "No waste was found for this system."}`],
        table: {
          cols: [col("Metric", 0.4), col("Value", 0.28, "r"), col("Reference / target", 0.32)],
          rows: [
            ["Building", b.name, `${b.type}, ${fmt(b.areaM2)} m²`],
            [C("System energy", null, true), C(`${fmt(kwh)} kWh`, null, true), P.short],
            ["Share of building energy", pctF(kwh / x.kwh), `Building total ${fmt(x.kwh)} kWh`],
            ["Cost (estimated)", inr(x.cost * kwh / x.kwh), "Building cost shared by energy"],
            ...(s.id === "chiller" ? [["Cooling delivered", `${fmt(x.trh)} TRh`, ""]] : []),
            ["Key indicator", kpi, target],
            ["Avoidable cost in period", C(inr(avoid), avoid > 0 ? "warning" : "good"), ""],
            [C("Savings opportunities", null, true), C(`${inr(month)} / month`, month > 0 ? "warning" : "good", true), `${fs.length} finding${fs.length === 1 ? "" : "s"}`],
            ["Faults in period", C(`${faults.length} (${faults.filter((e) => e.status !== "resolved").length} open)`, faults.some((e) => e.status !== "resolved") ? "critical" : "good"), ""],
            ["Status", sysStatus(fs, faults, s.id), ""]
          ]
        }
      });
      add("daily", "Daily energy", "This system's energy for each day in the period.", { table: dailyTable(sim, P, [x], s.id) });
      const eq = K().equipment(sim, b.id, s.id);
      add("equipment", "Equipment status", `Readings at the time the report was generated (${tFmt.format(new Date(sim.t))}).`, {
        table: { cols: [col("Equipment", 0.26), col("Status", 0.14), col("Reading", 0.25), col("Detail", 0.35)],
          rows: eq.map((r) => [r[0], C(r[1], /TRIP|STUCK|FAIL|ALARM/.test(r[1]) ? "critical" : null), r[2], r[3]]) }
      });
      const sv = savingsTable(fs, false, P);
      add("savings", "Savings opportunities", "Waste found for this system, with the recommended action.", sv ? { table: sv } : { paras: ["No savings opportunities were found for this system."] });
      const ft = faultsTable(sim, faults, false);
      add("faults", "Faults and alarms", "Faults on this system in the period.", ft ? { table: ft } : { paras: ["No faults on this system in the period."] });
    }

    else {   // comparison
      const list = opts.buildings.map((id) => bstats(sim, bById(id), P));
      const bySys = opts.compareBy === "system";
      const s = bySys ? DEMO.SYSTEMS.find((q) => q.id === opts.system) : null;
      title = bySys ? "System Comparison Report" : "Building Comparison Report";
      scope = bySys ? `${s.name} compared across ${list.map((x) => x.b.name).join(", ")}` : `Comparison of ${list.map((x) => x.b.name).join(", ")}`;
      scopeShort = (bySys ? s.id + "-" : "") + opts.buildings.join("-");

      if (!bySys) {
        const best = list.slice().sort((a, b) => a.kwhM2 - b.kwhM2);
        add("summary", "Key figures side by side", "Best value in green, weakest in red.", {
          paras: [`Per square metre, ${best[0].b.name} used the least energy (${fmt(best[0].kwhM2, 2)} kWh/m²) and ${best[best.length - 1].b.name} the most (${fmt(best[best.length - 1].kwhM2, 2)} kWh/m²). Combined savings found: ${inrS(sum(list.map((x) => x.savingsMonth)))} per month.`],
          table: compareTable(list, compareMetrics())
        });
        const cols = [col("System", 0.28)];
        for (const x of list) cols.push(col(`${x.b.id} kWh (share)`, 0.72 / list.length, "r"));
        add("systems", "Energy by system", "Energy for each system in each building, with its share of that building's total.", {
          table: { cols, rows: [
            ...DEMO.SYSTEMS.map((q) => [q.name, ...list.map((x) => `${fmt(x.sys[q.id])} (${pctF(x.sys[q.id] / x.kwh, 0)})`)]),
            [C("Total", null, true), ...list.map((x) => C(fmt(x.kwh), null, true))]] }
        });
        add("daily", "Daily energy", "Total energy for each day in the period.", { table: dailyTable(sim, P, list) });
      } else {
        const v = (x) => x.sys[s.id];
        const avoid = (x) => sum(x.findings.filter((f) => f.system === s.id).map((f) => f.costPeriod));
        const month = (x) => sum(x.findings.filter((f) => f.system === s.id).map((f) => f.costMonth));
        const metrics = [
          ["System energy (kWh)", v, (n) => fmt(n), "low"],
          ["Share of building energy", (x) => v(x) / x.kwh, (n) => pctF(n), "low"],
          ["System energy per m² (kWh/m²)", (x) => v(x) / x.area, (n) => fmt(n, 3), "low"],
          ["Cost est. (Rs)", (x) => x.cost * v(x) / x.kwh, (n) => inr(n), "low"],
          ...(s.id === "chiller" ? [["Plant efficiency (kW/TR)", (x) => x.kwPerTR, (n) => fmt(n, 2), "low"], ["Cooling delivered (TRh)", (x) => x.trh, (n) => fmt(n), null]] : []),
          ...(s.id === "ups" ? [["UPS efficiency", (x) => x.upsOut / (x.upsOut + x.sys.ups), (n) => pctF(n), "high"]] : []),
          ["Avoidable cost in period (Rs)", avoid, (n) => inr(n), "low"],
          ["Savings found (Rs / month)", month, (n) => inr(n), "low"],
          ["Faults in period", (x) => x.faults.filter((e) => e.system === s.id).length, (n) => fmt(n), "low"]
        ];
        const ranked = list.slice().sort((a, b) => v(a) / a.area - v(b) / b.area);
        add("summary", "Key figures side by side", "Best value in green, weakest in red.", {
          paras: [`${s.name}: per square metre, ${ranked[0].b.name} used the least (${fmt(v(ranked[0]) / ranked[0].area, 3)} kWh/m²) and ${ranked[ranked.length - 1].b.name} the most (${fmt(v(ranked[ranked.length - 1]) / ranked[ranked.length - 1].area, 3)} kWh/m²).`],
          table: compareTable(list, metrics)
        });
        add("daily", "Daily energy", `${s.name} energy for each day in the period.`, { table: dailyTable(sim, P, list, s.id) });
      }
      const fl = list.flatMap((x) => x.findings).filter((f) => !bySys || f.system === s.id).sort((a, b) => b.costMonth - a.costMonth);
      const sv = savingsTable(fl, true, P);
      add("savings", "Savings opportunities", "Waste found in the compared buildings, ranked by estimated cost per month.", sv ? { table: sv } : { paras: ["No savings opportunities were found."] });
      add("quality", "Data quality", "Readings are expected every 15 minutes from each building's gateway.", { table: qualityTable(list) });
    }

    add("signoff", "Sign-off", "Prepared from the energy monitoring system. Review and approve before circulation.", { table: signoff(user, sim.t) });

    const typeName = TYPES.find((t) => t.id === opts.type).name;
    const no = `BCN-${stamp(sim.t)}-${CODE[opts.type]}`;
    return {
      opts: JSON.parse(JSON.stringify(opts)),
      no, title, type: opts.type, typeName, scope,
      period: P.label, periodShort: P.short,
      generatedAt: sim.t, generatedOn: dtFmt(sim.t),
      generatedBy: `${user.name}, ${user.role}`,
      source: "BEACON - simulated demo data (15-minute readings)",
      company: DEMO.COMPANY,
      filename: `BEACON_${typeName}_${scopeShort.replace(/[^A-Za-z0-9-]+/g, "-")}_${stamp(sim.t)}.pdf`,
      sections: secs
    };
  }

  function compareMetrics() {
    return [
      ["Building type", (x) => x.b.type, (v) => v, null],
      ["Floor area (m²)", (x) => x.area, (n) => fmt(n), null],
      ["Energy consumed (kWh)", (x) => x.kwh, (n) => fmt(n), null],
      ["Energy intensity (kWh/m²)", (x) => x.kwhM2, (n) => fmt(n, n < 1 ? 3 : 2), "low"],
      ["EUI, annualised (kWh/m²/yr)", (x) => x.eui, (n) => fmt(n), "low"],
      ["Energy cost (Rs)", (x) => x.cost, (n) => inr(n), null],
      ["Cost per m² (Rs)", (x) => x.cost / x.area, (n) => "₹" + fmt(n, 2), "low"],
      ["Peak demand (kVA)", (x) => x.maxKva, (n) => fmt(n), null],
      ["Solar share", (x) => x.solar / x.kwh, (n) => pctF(n), "high"],
      ["Chiller plant (kW/TR)", (x) => x.kwPerTR, (n) => fmt(n, 2), "low"],
      ["Savings found (Rs / month)", (x) => x.savingsMonth, (n) => inr(n), "low"],
      ["Open faults", (x) => x.openFaults, (n) => fmt(n), "low"],
      ["Data completeness", (x) => x.completeness, (n) => pctF(n), "high"]
    ];
  }

  /* ---------------------------------------------------------------------
     On-screen preview (HTML). All text set with textContent.
     --------------------------------------------------------------------- */
  const LOGO_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>';
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function tableHTML(tb) {
    const t = el("table", "rpt-table" + (tb.tall ? " tall" : ""));
    const cg = el("colgroup");
    for (const c of tb.cols) { const ce = el("col"); ce.style.width = (c.w * 100).toFixed(1) + "%"; cg.appendChild(ce); }
    t.appendChild(cg);
    const hr = t.createTHead().insertRow();
    for (const c of tb.cols) { const th = el("th", c.align === "r" ? "r" : "", c.h); hr.appendChild(th); }
    const body = t.createTBody();
    for (const r of tb.rows) {
      const tr = body.insertRow();
      r.forEach((cell, i) => {
        const td = tr.insertCell();
        const c = typeof cell === "object" && cell ? cell : { t: cell == null ? "" : String(cell) };
        td.textContent = c.t;
        if (tb.cols[i] && tb.cols[i].align === "r") td.classList.add("r");
        if (c.tone) td.classList.add("tone-" + c.tone);
        if (c.b) td.classList.add("b");
      });
    }
    const wrap = el("div", "rpt-table-wrap"); wrap.appendChild(t);
    return wrap;
  }

  function toHTML(m) {
    const p = el("article", "paper");
    const head = el("header", "rpt-head");
    const logo = el("div", "rpt-logo");
    if (m.company.logo) { const img = el("img"); img.src = m.company.logo; img.alt = ""; logo.appendChild(img); logo.classList.add("has-img"); }
    else logo.innerHTML = LOGO_SVG;
    const co = el("div", "rpt-co");
    co.append(el("b", "", m.company.name), el("span", "", m.company.division), el("span", "", m.company.address));
    const right = el("div", "rpt-headr");
    right.append(el("b", "", "ENERGY PERFORMANCE REPORT"), el("span", "", m.no));
    head.append(logo, co, right);
    p.appendChild(head);

    const tb = el("div", "rpt-titleblock");
    tb.append(el("h2", "", m.title), el("p", "rpt-scope", "Scope: " + m.scope));
    p.appendChild(tb);
    const meta = el("dl", "rpt-meta");
    for (const [k, v] of metaPairs(m)) meta.append(el("dt", "", k), el("dd", "", v));
    p.appendChild(meta);

    m.sections.forEach((s, i) => {
      const sec = el("section", "rpt-sec");
      sec.appendChild(el("h3", "", `${i + 1}. ${s.title}`));
      if (s.intro) sec.appendChild(el("p", "rpt-intro", s.intro));
      for (const t of s.paras || []) sec.appendChild(el("p", "rpt-p", t));
      if (s.table) sec.appendChild(tableHTML(s.table));
      p.appendChild(sec);
    });
    const foot = el("footer", "rpt-foot");
    foot.append(el("span", "", "Confidential - for internal use only"), el("span", "", "Generated by BEACON (demo, simulated data)"));
    p.appendChild(foot);
    return p;
  }

  function metaPairs(m) {
    return [["Report no.", m.no], ["Report type", m.typeName], ["Scope", m.scope], ["Period", m.period],
            ["Generated on", m.generatedOn], ["Generated by", m.generatedBy], ["Data source", m.source]];
  }

  /* ---------------------------------------------------------------------
     PDF (pdf-lib, A4 portrait, built-in Helvetica)
     --------------------------------------------------------------------- */
  /* Built-in PDF fonts only know the Windows-1252 character set. */
  const WIN_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
  function pdfText(s) {
    return String(s == null ? "" : s)
      .replace(/₹\s?/g, "Rs ").replace(/Δ/g, "delta ").replace(/≤/g, "<=").replace(/≥/g, ">=")
      .replace(/₂/g, "2").replace(/²/g, "2").replace(/³/g, "3").replace(/−/g, "-").replace(/[   ]/g, " ")
      .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, (ch) => (WIN_EXTRA.includes(ch) ? ch : ""));
  }

  const RGB = (h) => { const n = parseInt(h.slice(1), 16); return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

  async function toPDF(m) {
    if (!window.PDFLib) throw new Error("The PDF library did not load. Check the internet connection and reload the page.");
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle(pdfText(`${m.title} - ${m.no}`));
    doc.setAuthor(pdfText(m.company.name));
    doc.setSubject(pdfText(m.scope));
    doc.setCreator("BEACON (demo)");
    doc.setProducer("BEACON (demo)");
    doc.setCreationDate(new Date());
    const F = await doc.embedFont(StandardFonts.Helvetica);
    const FB = await doc.embedFont(StandardFonts.HelveticaBold);
    let logoImg = null;
    if (m.company.logo) {
      try {
        logoImg = /^data:image\/jpe?g/i.test(m.company.logo) ? await doc.embedJpg(m.company.logo) : await doc.embedPng(m.company.logo);
      } catch (e) { logoImg = null; }
    }

    const W = 595.28, H = 841.89, M = 40, CW = W - 2 * M, BOTTOM = M + 26;
    const col = {
      navy: RGB("#0d2131"), teal: RGB("#0a7f73"), ink: RGB("#18222f"), ink2: RGB("#3c4a5c"), muted: RGB("#6b7a8f"),
      border: RGB("#c9d1db"), hair: RGB("#e1e6ec"), zebra: RGB("#f4f6f8"), white: RGB("#ffffff"), soft: RGB("#eef6f5"),
      good: RGB("#0b6e0b"), goodBg: RGB("#e3f2e3"), warning: RGB("#8a5a00"), warningBg: RGB("#fcefcf"), critical: RGB("#b02828"), criticalBg: RGB("#f9e1e1")
    };

    let page, y;

    function wrap(text, font, size, width) {
      const out = [];
      for (const para of pdfText(text).split("\n")) {
        const words = para.split(/\s+/).filter(Boolean);
        let line = "";
        for (let w of words) {
          while (font.widthOfTextAtSize(w, size) > width) {      // a single word longer than the column
            let k = w.length - 1;
            while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
            if (line) { out.push(line); line = ""; }
            out.push(w.slice(0, k)); w = w.slice(k);
          }
          const test = line ? line + " " + w : w;
          if (font.widthOfTextAtSize(test, size) <= width) line = test;
          else { if (line) out.push(line); line = w; }
        }
        out.push(line);
      }
      return out;
    }
    const text = (s, x, yy, size, font, color) => page.drawText(pdfText(s), { x, y: yy, size, font: font || F, color: color || col.ink });

    function drawLogo(x, top, size) {
      if (logoImg) {
        const sc = Math.min(size / logoImg.width, size / logoImg.height);
        const w = logoImg.width * sc, h = logoImg.height * sc;
        page.drawImage(logoImg, { x, y: top - h, width: w, height: h });
        return;
      }
      page.drawRectangle({ x, y: top - size, width: size, height: size, color: col.teal });
      const s = size / 24 * 0.8;
      page.drawSvgPath("M13 2 L4 14 L11 14 L10 22 L19 10 L12 10 L13 2 Z", { x: x + size * 0.1, y: top - size * 0.1, scale: s, color: col.white });
    }

    function newPage() {
      page = doc.addPage([W, H]);
      const top = H - M + 8;
      drawLogo(M, top, 30);
      text(m.company.name, M + 40, top - 11, 11.5, FB, col.navy);
      text(`${m.company.division}  |  ${m.company.address}`, M + 40, top - 24, 7.5, F, col.muted);
      const r1 = "ENERGY PERFORMANCE REPORT", r2 = m.no;
      text(r1, W - M - FB.widthOfTextAtSize(r1, 7.5), top - 11, 7.5, FB, col.teal);
      text(r2, W - M - F.widthOfTextAtSize(pdfText(r2), 7.5), top - 23, 7.5, F, col.muted);
      page.drawRectangle({ x: M, y: top - 38, width: CW, height: 1.6, color: col.navy });
      y = top - 54;
    }
    const need = (h) => { if (y - h < BOTTOM) newPage(); };

    function paragraph(s, size, font, color, lead) {
      const lines = wrap(s, font || F, size, CW);
      for (const ln of lines) { need(lead); text(ln, M, y - size, size, font, color); y -= lead; }
    }

    function drawTable(tb, opts) {
      const size = 7.6, lead = 9.6, padX = 4.5, padY = 4.2, minH = tb.tall ? 30 : 0;
      const widths = tb.cols.map((c) => c.w * CW);
      const xs = []; widths.reduce((acc, w, i) => { xs[i] = acc; return acc + w; }, M);
      const header = tb.cols.map((c, i) => wrap(c.h, FB, size, widths[i] - 2 * padX));
      const headH = Math.max(...header.map((l) => l.length)) * lead + 2 * padY;
      const drawHead = () => {
        page.drawRectangle({ x: M, y: y - headH, width: CW, height: headH, color: col.navy });
        header.forEach((lines, i) => lines.forEach((ln, k) => {
          const w = FB.widthOfTextAtSize(ln, size);
          const x = tb.cols[i].align === "r" ? xs[i] + widths[i] - padX - w : xs[i] + padX;
          text(ln, x, y - padY - (k + 1) * lead + 2.4, size, FB, col.white);
        }));
        y -= headH;
      };
      const plain = opts && opts.noHead;
      if (!plain) { need(headH + 24); drawHead(); }
      tb.rows.forEach((row, ri) => {
        const cells = row.map((cell, i) => {
          const c = typeof cell === "object" && cell ? cell : { t: cell == null ? "" : String(cell) };
          const font = c.b || (plain && i % 2 === 0) ? FB : F;
          return { c, font, lines: wrap(c.t, font, size, widths[i] - 2 * padX) };
        });
        const h = Math.max(minH, Math.max(...cells.map((x) => x.lines.length)) * lead + 2 * padY);
        if (y - h < BOTTOM) { newPage(); if (!plain) drawHead(); }
        if (plain ? false : ri % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: col.zebra });
        if (plain) page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: ri % 2 ? col.white : col.zebra });
        cells.forEach(({ c, font, lines }, i) => {
          if (c.tone) page.drawRectangle({ x: xs[i] + 1.5, y: y - h + 1.5, width: widths[i] - 3, height: h - 3, color: col[c.tone + "Bg"] });
          const color = c.tone ? col[c.tone] : (plain && i % 2 === 0 ? col.ink2 : col.ink);
          lines.forEach((ln, k) => {
            const w = font.widthOfTextAtSize(ln, size);
            const x = tb.cols[i].align === "r" ? xs[i] + widths[i] - padX - w : xs[i] + padX;
            text(ln, x, y - padY - (k + 1) * lead + 2.4, size, font, color);
          });
        });
        page.drawLine({ start: { x: M, y: y - h }, end: { x: M + CW, y: y - h }, thickness: 0.5, color: col.hair });
        y -= h;
      });
      page.drawLine({ start: { x: M, y }, end: { x: M + CW, y }, thickness: 0.9, color: col.border });
      y -= 6;
    }

    /* ---- page 1: title block ---- */
    newPage();
    page.drawRectangle({ x: M, y: y - 52, width: CW, height: 52, color: col.soft });
    page.drawRectangle({ x: M, y: y - 52, width: 3, height: 52, color: col.teal });
    text(m.title, M + 14, y - 22, 17, FB, col.navy);
    const scopeLines = wrap("Scope: " + m.scope, FB, 9, CW - 28);
    text(scopeLines[0], M + 14, y - 39, 9, FB, col.teal);
    y -= 52;
    for (const ln of scopeLines.slice(1)) { text(ln, M + 14, y - 11, 9, FB, col.teal); y -= 12; }
    y -= 10;
    const pairs = metaPairs(m);
    const metaRows = [];
    for (let i = 0; i < pairs.length; i += 2) metaRows.push([pairs[i][0], pairs[i][1], ...(pairs[i + 1] || ["", ""])]);
    drawTable({ cols: [{ w: 0.14 }, { w: 0.36 }, { w: 0.14 }, { w: 0.36 }], rows: metaRows }, { noHead: true });
    y -= 8;

    /* ---- sections ---- */
    m.sections.forEach((s, i) => {
      need(70);
      y -= 6;
      page.drawRectangle({ x: M, y: y - 13, width: 3, height: 13, color: col.teal });
      text(`${i + 1}. ${s.title}`, M + 9, y - 11, 11.5, FB, col.navy);
      y -= 20;
      if (s.intro) { paragraph(s.intro, 8, F, col.muted, 10.5); y -= 3; }
      for (const t of s.paras || []) { paragraph(t, 9, F, col.ink, 12.5); y -= 4; }
      if (s.table) drawTable(s.table);
      y -= 8;
    });

    /* ---- footer on every page ---- */
    const pages = doc.getPages();
    pages.forEach((pg, i) => {
      page = pg;
      pg.drawLine({ start: { x: M, y: M - 2 }, end: { x: W - M, y: M - 2 }, thickness: 0.5, color: col.border });
      text("Confidential - for internal use only", M, M - 13, 7, F, col.muted);
      const mid = "Generated by BEACON (demo, simulated data)";
      text(mid, (W - F.widthOfTextAtSize(mid, 7)) / 2, M - 13, 7, F, col.muted);
      const pn = `Page ${i + 1} of ${pages.length}`;
      text(pn, W - M - FB.widthOfTextAtSize(pn, 7), M - 13, 7, FB, col.ink2);
    });

    return doc.save();
  }

  /* Save the PDF. Works when the page is opened straight from a folder (file://). */
  async function download(m) {
    const bytes = await toPDF(m);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = m.filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return bytes.length;
  }

  DEMO.report = { TYPES, PERIODS, SECTIONS, period, build, toHTML, toPDF, download, pdfText };
})();
