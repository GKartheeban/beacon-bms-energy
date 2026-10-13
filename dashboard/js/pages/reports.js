/* =========================================================================
   Page 6 - Reports
   Pick a report type, scope, period and sections; check the preview;
   download an A4 PDF with the company header. The report engine is in
   js/report.js. Reports always use the KPI figures, whichever view is on.
   ========================================================================= */

(function () {
  const R = () => DEMO.report;
  const tFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dtFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

  function allowedBuildings() { return DEMO.BUILDINGS.filter((b) => DEMO.auth.canSee(b.id)); }
  function allowedTypes(user) {
    return R().TYPES.filter((t) => user.buildings === "ALL" || t.id === "building" || t.id === "system");
  }

  function defaults(state) {
    const bs = allowedBuildings().map((b) => b.id);
    const type = state.user.buildings === "ALL" ? "portfolio" : "building";
    return {
      type, period: "today",
      buildings: bs.slice(),                       // portfolio
      cmpBuildings: bs.slice(0, 3),                // comparison
      building: DEMO.ui.pageBuilding(state),       // building / system
      system: "chiller", compareBy: "buildings",
      sections: R().SECTIONS[type].map((s) => s[0])
    };
  }

  function engineOpts(o) {
    return {
      type: o.type, period: o.period, system: o.system, compareBy: o.compareBy, building: o.building,
      buildings: o.type === "comparison" ? o.cmpBuildings : o.buildings,
      sections: o.sections
    };
  }

  function problem(o) {
    if (o.type === "portfolio" && o.buildings.length < 1) return "Pick at least one building.";
    if (o.type === "comparison" && (o.cmpBuildings.length < 2 || o.cmpBuildings.length > 3)) return "Pick 2 or 3 buildings to compare.";
    if (!o.sections.length) return "Pick at least one section.";
    return null;
  }

  /* ---------------------------------------------------------------------- */
  function render(el, state) {
    const ok = state.reportOpts && allowedTypes(state.user).some((t) => t.id === state.reportOpts.type) && state.reportUser === state.user.username;
    if (!ok) { state.reportOpts = defaults(state); state.reportUser = state.user.username; }
    state.reports = state.reports || [];

    el.innerHTML = `
      <div class="page-head">
        <div><h1>Reports</h1><p>Build a report for management, check the preview, then download it as a PDF.</p></div>
        <p class="mode-note">Reports always use the KPI figures, whichever view is switched on.</p>
      </div>
      <div class="rpt-layout">
        <div class="rpt-side">
          <section class="card rpt-builder" aria-label="Report settings">
            <div class="card-head"><div><h2>Report settings</h2><p>Four steps, then download.</p></div></div>
            <div class="rb-step">
              <div class="rb-label"><span class="rb-num">1</span>Report type</div>
              <div class="type-grid" id="rb-types" role="radiogroup" aria-label="Report type"></div>
            </div>
            <div class="rb-step">
              <div class="rb-label"><span class="rb-num">2</span>Scope</div>
              <div id="rb-scope" class="rb-scope"></div>
            </div>
            <div class="rb-step">
              <div class="rb-label"><span class="rb-num">3</span>Period</div>
              <div class="segmented rb-period" id="rb-period" role="group" aria-label="Period"></div>
            </div>
            <div class="rb-step">
              <div class="rb-label"><span class="rb-num">4</span>Sections</div>
              <div class="check-list" id="rb-sections"></div>
            </div>
            <p class="rb-error" id="rb-error" role="alert" hidden></p>
            <button class="btn btn-primary btn-block" id="rb-download" type="button">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>
              Download PDF
            </button>
            <p class="rb-status muted" id="rb-status">A4 PDF with your company header, scope and tables.</p>
          </section>

          <section class="card" aria-label="Recent reports">
            <div class="card-head"><div><h2>Recent reports</h2><p>Downloaded in this session.</p></div></div>
            <ul class="recent-list" id="rb-recent"></ul>
          </section>
        </div>

        <section class="card rpt-preview-card" aria-label="Report preview">
          <div class="card-head">
            <div><h2>Preview</h2><p id="rb-asof"></p></div>
            <button class="btn btn-sm" id="rb-refresh" type="button">Refresh data</button>
          </div>
          <div class="paper-wrap" id="rb-paper"></div>
        </section>
      </div>`;

    el.querySelector("#rb-download").addEventListener("click", () => doDownload(el, state));
    el.querySelector("#rb-refresh").addEventListener("click", () => preview(el, state));
    drawControls(el, state);
    preview(el, state);
    drawRecent(el, state);
  }

  /* ---------- the four steps ---------- */
  function drawControls(el, state) {
    const o = state.reportOpts;
    const changed = () => { drawControls(el, state); preview(el, state); };

    /* 1. type */
    const types = el.querySelector("#rb-types");
    types.innerHTML = "";
    for (const t of allowedTypes(state.user)) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "type-card";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(o.type === t.id));
      b.innerHTML = "<b></b><span></span>";
      b.querySelector("b").textContent = t.name;
      b.querySelector("span").textContent = t.desc;
      b.addEventListener("click", () => {
        if (o.type === t.id) return;
        o.type = t.id; o.sections = R().SECTIONS[t.id].map((s) => s[0]); changed();
      });
      types.appendChild(b);
    }

    /* 2. scope */
    const scope = el.querySelector("#rb-scope");
    scope.innerHTML = "";
    const bs = allowedBuildings();
    const selectField = (label, id, options, value, onChange) => {
      const f = document.createElement("div"); f.className = "field";
      const l = document.createElement("label"); l.htmlFor = id; l.textContent = label;
      const s = document.createElement("select"); s.className = "select"; s.id = id;
      for (const [v, n] of options) s.add(new Option(n, v));
      s.value = value; s.disabled = options.length === 1;
      s.addEventListener("change", () => onChange(s.value));
      f.append(l, s); scope.appendChild(f);
    };
    const checks = (label, list, chosen, max, onToggle) => {
      const f = document.createElement("fieldset"); f.className = "check-group";
      const lg = document.createElement("legend"); lg.textContent = label; f.appendChild(lg);
      for (const b of list) {
        const lab = document.createElement("label"); lab.className = "check";
        const c = document.createElement("input"); c.type = "checkbox"; c.value = b.id; c.checked = chosen.includes(b.id);
        c.disabled = !c.checked && max && chosen.length >= max;
        c.addEventListener("change", () => onToggle(b.id, c.checked));
        const sp = document.createElement("span"); sp.innerHTML = "<b></b><small></small>";
        sp.querySelector("b").textContent = b.name;
        sp.querySelector("small").textContent = `${b.type}, ${b.city}`;
        lab.append(c, sp); f.appendChild(lab);
      }
      scope.appendChild(f);
    };
    const toggle = (arr, id, on) => { const i = arr.indexOf(id); if (on && i < 0) arr.push(id); if (!on && i >= 0) arr.splice(i, 1); arr.sort((a, b) => DEMO.BUILDINGS.findIndex((x) => x.id === a) - DEMO.BUILDINGS.findIndex((x) => x.id === b)); };
    const bOpts = bs.map((b) => [b.id, `${b.name} (${b.type})`]);
    const sOpts = DEMO.SYSTEMS.map((s) => [s.id, s.name]);
    if (!bs.some((b) => b.id === o.building)) o.building = bs[0].id;

    if (o.type === "portfolio") {
      checks("Buildings to include", bs, o.buildings, 0, (id, on) => { toggle(o.buildings, id, on); changed(); });
      const n = document.createElement("p"); n.className = "rb-hint";
      n.textContent = o.buildings.length === bs.length ? "All buildings: the report is titled as the overall portfolio." : "Selected buildings only: the scope line lists them by name.";
      scope.appendChild(n);
    } else if (o.type === "building") {
      selectField("Building", "rb-building", bOpts, o.building, (v) => { o.building = v; changed(); });
    } else if (o.type === "system") {
      selectField("Building", "rb-building", bOpts, o.building, (v) => { o.building = v; changed(); });
      selectField("System", "rb-system", sOpts, o.system, (v) => { o.system = v; changed(); });
    } else {
      const seg = document.createElement("div");
      seg.className = "segmented rb-compare"; seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Compare");
      for (const [v, n] of [["buildings", "Whole buildings"], ["system", "One system"]]) {
        const b = document.createElement("button"); b.type = "button"; b.textContent = n;
        b.setAttribute("aria-pressed", String(o.compareBy === v));
        b.addEventListener("click", () => {
          if (o.compareBy === v) return;
          o.compareBy = v;
          o.sections = R().SECTIONS.comparison.map((s) => s[0]).filter((k) => v === "buildings" || k !== "systems");
          changed();
        });
        seg.appendChild(b);
      }
      scope.appendChild(seg);
      if (o.compareBy === "system") selectField("System", "rb-system", sOpts, o.system, (v) => { o.system = v; changed(); });
      checks("Buildings to compare (2 or 3)", bs, o.cmpBuildings, 3, (id, on) => { toggle(o.cmpBuildings, id, on); changed(); });
    }

    /* 3. period */
    const per = el.querySelector("#rb-period");
    per.innerHTML = "";
    for (const p of R().PERIODS) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = p.name;
      b.setAttribute("aria-pressed", String(o.period === p.id));
      b.addEventListener("click", () => { o.period = p.id; changed(); });
      per.appendChild(b);
    }

    /* 4. sections */
    const secs = el.querySelector("#rb-sections");
    secs.innerHTML = "";
    const avail = R().SECTIONS[o.type].filter(([k]) => !(o.type === "comparison" && o.compareBy === "system" && k === "systems"));
    for (const [k, name] of avail) {
      const lab = document.createElement("label"); lab.className = "check";
      const c = document.createElement("input"); c.type = "checkbox"; c.checked = o.sections.includes(k);
      c.addEventListener("change", () => {
        const order = avail.map((a) => a[0]);
        o.sections = order.filter((x) => (x === k ? c.checked : o.sections.includes(x)));
        preview(el, state);
      });
      const sp = document.createElement("span"); sp.textContent = name;
      lab.append(c, sp); secs.appendChild(lab);
    }
  }

  /* ---------- preview ---------- */
  function preview(el, state) {
    const o = state.reportOpts;
    const err = problem(o);
    const errEl = el.querySelector("#rb-error");
    errEl.hidden = !err; errEl.textContent = err || "";
    el.querySelector("#rb-download").disabled = !!err;
    const paper = el.querySelector("#rb-paper");
    paper.innerHTML = "";
    if (err) {
      const p = document.createElement("div"); p.className = "paper-empty"; p.textContent = err;
      paper.appendChild(p);
      return null;
    }
    const model = R().build(state.sim, engineOpts(o), state.user);
    paper.appendChild(R().toHTML(model));
    state.reportAsOf = state.sim.t;
    el.querySelector("#rb-asof").textContent = `Data as of ${tFmt.format(new Date(state.sim.t))} (simulated time). The PDF uses the latest data when you download.`;
    return model;
  }

  async function doDownload(el, state) {
    const btn = el.querySelector("#rb-download");
    const status = el.querySelector("#rb-status");
    const model = preview(el, state);          // latest data, so preview and PDF match
    if (!model) return;
    btn.disabled = true; status.textContent = "Creating PDF...";
    try {
      const bytes = await R().download(model);
      state.reports.unshift({ model, bytes, at: Date.now() });
      if (state.reports.length > 8) state.reports.pop();
      status.textContent = `Downloaded ${model.filename} (${Math.max(1, Math.round(bytes / 1024))} KB).`;
      drawRecent(el, state);
    } catch (e) {
      status.textContent = "Could not create the PDF: " + e.message;
    } finally {
      btn.disabled = !!problem(state.reportOpts);
    }
  }

  function drawRecent(el, state) {
    const ul = el.querySelector("#rb-recent");
    ul.innerHTML = "";
    if (!state.reports.length) {
      const li = document.createElement("li"); li.className = "recent-empty muted";
      li.textContent = "No reports yet. Downloaded reports appear here so you can download them again.";
      ul.appendChild(li); return;
    }
    for (const r of state.reports) {
      const m = r.model;
      const li = document.createElement("li");
      li.innerHTML = `<div><b></b><span class="muted"></span><small class="muted"></small></div><button class="btn btn-sm" type="button">Download</button>`;
      li.querySelector("b").textContent = m.title;
      li.querySelector("span").textContent = `${m.scope} · ${m.periodShort}`;
      li.querySelector("small").textContent = `${m.no} · data as of ${dtFmt.format(new Date(m.generatedAt))}`;
      li.querySelector("button").setAttribute("aria-label", `Download ${m.filename} again`);
      li.querySelector("button").addEventListener("click", () => R().download(m));
      ul.appendChild(li);
    }
  }

  /* The clock ticks every few seconds; the preview is not redrawn on each tick
     (that would jump while reading). Only the "as of" note changes. */
  function update(el, state) {
    const note = el.querySelector("#rb-asof");
    if (!note || !state.reportAsOf) return;
    if (state.sim.t !== state.reportAsOf) {
      note.textContent = `Data as of ${tFmt.format(new Date(state.reportAsOf))}. Newer readings have arrived; the PDF will include them.`;
    }
  }

  DEMO.pages = DEMO.pages || {};
  DEMO.pages.reports = { render, update };
})();
