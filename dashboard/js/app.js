/* =========================================================================
   app.js - app shell: login, navigation, KPI switch, theme, building
   selector, simulation clock. Each page lives in its own file under
   js/pages/ and registers itself in DEMO.pages.
   ========================================================================= */

(function () {
  const $ = (id) => document.getElementById(id);

  const PAGES = [
    { id: "overview", name: "Portfolio Overview" },
    { id: "building", name: "Building View" },
    { id: "system",   name: "System Detail" },
    { id: "faults",   name: "Faults & Alerts" },
    { id: "insights", name: "Energy Insights" },
    { id: "reports",  name: "Reports" }
  ];

  /* What each page will show, until it is built (step-by-step plan). */
  const PLANNED = {
    overview: ["All buildings at a glance", ["Six headline tiles: live load, energy today, cost, EUI, open faults, savings found", "Building comparison table", "Combined load profile for today"]],
    building: ["One building in detail", ["Load profile today, stacked by system, with efficient baseline and yesterday", "Energy by system, ranked", "System cards that open System Detail"]],
    system:   ["One system in detail", ["Equipment list with live readings", "Today's trend for the system", "KPIs against targets and waste findings"]],
    faults:   ["Live faults and alerts", ["Gateway offline, equipment trips, grid outage / DG run, stuck sensors", "Severity, building, start time, status, acknowledge", "Gateway health per building"]],
    insights: ["Where energy is wasted", ["Day × hour heatmap for the last 7 days", "Waste findings ranked by ₹ per month, with cause and action", "Total savings found"]],
    reports:  ["Reports for management", ["Portfolio, building, system or comparison report", "Today, yesterday or last 7 days", "PDF with company header and standard tables"]]
  };

  /* simple line icons for the sidebar */
  const ICONS = {
    overview: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    building: '<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><path d="M8 7h4M8 11h4M8 15h4M3 21h18"/>',
    system:   '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    faults:   '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    insights: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    reports:  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'
  };

  DEMO.pages = DEMO.pages || {};

  const state = {
    user: null,
    mode: "kpi",          // "raw" | "kpi"
    scope: "ALL",         // building id or "ALL"
    page: null, param: null,
    playing: true, speed: 4000,
    sim: null, timer: null
  };
  DEMO.state = state;

  /* ---------- preferences (per browser, optional) ---------- */
  const pref = {
    get(k, d) { try { const v = sessionStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- login ---------- */
  function renderRoles() {
    const list = $("role-list");
    list.innerHTML = "";
    for (const u of DEMO.auth.users) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "role-btn";
      b.innerHTML = `<strong></strong><span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
      b.querySelector("strong").textContent = u.role;
      b.querySelector("span").textContent = u.description;
      b.addEventListener("click", () => { DEMO.auth.loginAs(u.username); enterApp(); });
      list.appendChild(b);
    }
  }

  function showLogin() {
    stopClock();
    $("view-app").hidden = true;
    $("view-login").hidden = false;
    $("login-error").hidden = true;
    $("login-form").reset();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  $("login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const u = DEMO.auth.login($("login-user").value, $("login-pass").value);
    if (!u) {
      const err = $("login-error");
      err.textContent = "Username or password not recognised. Use manager, hotel or operator with password demo, or pick a demo role below.";
      err.hidden = false;
      return;
    }
    enterApp();
  });

  /* ---------- app ---------- */
  function enterApp() {
    const u = DEMO.auth.current;
    state.user = u;
    $("view-login").hidden = true;
    $("view-app").hidden = false;

    $("user-initials").textContent = DEMO.auth.initials(u);
    $("user-name").textContent = u.name;
    $("user-role").textContent = u.role;
    $("dd-name").textContent = u.name;
    $("dd-role").textContent = u.role;
    $("dd-access").textContent = u.buildings === "ALL" ? "Access: all buildings" : "Access: " + DEMO.BUILDINGS.filter((b) => u.buildings.includes(b.id)).map((b) => b.name).join(", ");

    // building selector, limited to what this user may see
    const sel = $("scope");
    sel.innerHTML = "";
    const allowed = DEMO.BUILDINGS.filter((b) => DEMO.auth.canSee(b.id));
    if (u.buildings === "ALL") sel.add(new Option("All buildings", "ALL"));
    for (const b of allowed) sel.add(new Option(`${b.name} (${b.type})`, b.id));
    const savedScope = pref.get("eh-scope", u.buildings === "ALL" ? "ALL" : allowed[0].id);
    state.scope = [...sel.options].some((o) => o.value === savedScope) ? savedScope : sel.options[0].value;
    sel.value = state.scope;
    sel.disabled = sel.options.length === 1;

    // navigation for this role
    const nav = $("nav");
    nav.innerHTML = "";
    for (const p of PAGES.filter((p) => u.pages.includes(p.id))) {
      const a = document.createElement("a");
      a.href = "#" + p.id; a.dataset.page = p.id;
      a.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[p.id]}</svg><span></span>`;
      a.querySelector("span").textContent = p.name;
      if (p.id === "faults") { const c = document.createElement("b"); c.className = "nav-count"; c.id = "nav-faults"; c.hidden = true; a.appendChild(c); }
      nav.appendChild(a);
    }

    setMode(pref.get("eh-mode", "kpi"), true);
    if (!state.sim) { state.sim = new DEMO.Simulator(); state.sim.init(Date.now()); }
    startClock();
    if (!location.hash || !u.pages.includes(location.hash.slice(1).split("/")[0])) location.hash = u.home;
    else route();
  }

  $("logout").addEventListener("click", () => { closeMenu(); DEMO.auth.logout(); showLogin(); });

  /* user menu */
  function closeMenu() { $("user-dropdown").hidden = true; $("user-btn").setAttribute("aria-expanded", "false"); }
  $("user-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $("user-dropdown").hidden;
    $("user-dropdown").hidden = !open;
    $("user-btn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".user-menu")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  /* ---------- routing ---------- */
  function route() {
    if (!state.user) return;
    const [page, param] = location.hash.slice(1).split("/");
    if (!state.user.pages.includes(page)) { location.hash = state.user.home; return; }
    state.page = page; state.param = param ? decodeURIComponent(param) : null;
    for (const a of $("nav").querySelectorAll("a")) {
      if (a.dataset.page === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    }
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  function render() {
    const el = $("page");
    const def = DEMO.pages[state.page];
    const meta = PAGES.find((p) => p.id === state.page);
    document.title = `${meta.name} · BEACON`;
    if (def && def.render) { def.render(el, state); return; }
    const [subtitle, items] = PLANNED[state.page];
    el.innerHTML = `
      <div class="page-head"><div><h1></h1><p></p></div></div>
      <div class="placeholder">
        <h2>This page is coming in the next build step</h2>
        <p>Planned content:</p>
        <ul></ul>
      </div>`;
    el.querySelector("h1").textContent = meta.name;
    el.querySelector(".page-head p").textContent = subtitle;
    const ul = el.querySelector("ul");
    for (const it of items) { const li = document.createElement("li"); li.textContent = it; ul.appendChild(li); }
  }

  function update() {
    const def = DEMO.pages[state.page];
    if (def && def.update) def.update($("page"), state);
  }

  /* ---------- KPI switch ---------- */
  function setMode(mode, silent) {
    state.mode = mode === "raw" ? "raw" : "kpi";
    document.body.dataset.mode = state.mode;
    $("mode-raw").setAttribute("aria-pressed", String(state.mode === "raw"));
    $("mode-kpi").setAttribute("aria-pressed", String(state.mode === "kpi"));
    pref.set("eh-mode", state.mode);
    if (!silent) render();
  }
  $("mode-raw").addEventListener("click", () => setMode("raw"));
  $("mode-kpi").addEventListener("click", () => setMode("kpi"));

  /* ---------- building selector ---------- */
  $("scope").addEventListener("change", (e) => {
    state.scope = e.target.value; pref.set("eh-scope", state.scope); render();
  });

  /* ---------- theme ---------- */
  $("theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "light";
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("eh-theme", next); } catch (e) {}
    render();   // charts pick up the new colours
  });

  /* ---------- simulation clock ---------- */
  const clockFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

  function paintClock() {
    const sim = state.sim; if (!sim) return;
    $("clock").textContent = clockFmt.format(new Date(sim.t));
    const gw = $("gateways");
    gw.innerHTML = "";
    for (const b of DEMO.BUILDINGS.filter((x) => DEMO.auth.canSee(x.id))) {
      const st = sim.state[b.id];
      const s = document.createElement("span");
      s.className = "gw" + (st.offline ? " off" : "");
      s.title = st.offline ? `${b.name}: gateway offline, no readings received` : `${b.name}: gateway online`;
      s.innerHTML = "<i></i>";
      s.append(`${b.id} ${st.offline ? "offline" : "online"}`);
      gw.appendChild(s);
    }
    /* open fault count on the sidebar */
    const c = $("nav-faults");
    if (c) {
      const n = sim.events.filter((e) => e.kind === "fault" && e.status !== "resolved" && DEMO.auth.canSee(e.building)).length;
      c.textContent = n; c.hidden = n === 0;
    }
  }

  function tick() { state.sim.step(); paintClock(); update(); }
  function startClock() {
    stopClock(); paintClock();
    if (state.playing) state.timer = setInterval(tick, state.speed);
    $("icon-pause").hidden = !state.playing; $("icon-play").hidden = state.playing;
    $("play-label").textContent = state.playing ? "Pause" : "Play";
    $("play").setAttribute("aria-label", state.playing ? "Pause simulation" : "Resume simulation");
  }
  function stopClock() { if (state.timer) clearInterval(state.timer); state.timer = null; }
  $("play").addEventListener("click", () => { state.playing = !state.playing; startClock(); });
  $("speed").addEventListener("change", (e) => { state.speed = Number(e.target.value); startClock(); });

  window.addEventListener("resize", () => DEMO.charts && DEMO.charts.resize());

  /* ---------- start ---------- */
  renderRoles();
  if (DEMO.auth.restore()) enterApp(); else showLogin();

  DEMO.app = { render, update, setMode };
})();
