/* =========================================================================
   auth.js - demo login and roles.
   FOR DEMONSTRATION ONLY: there is no server, so this is not real security.
   The real product needs backend authentication (passwords or company SSO,
   sessions, audit log).
   ========================================================================= */

(function () {
  const USERS = [
    {
      username: "manager", name: "Priya Raman", role: "Portfolio Manager",
      description: "All buildings, cost and savings",
      buildings: "ALL", home: "overview",
      pages: ["overview", "building", "system", "faults", "insights", "reports"]
    },
    {
      username: "hotel", name: "Arjun Mehta", role: "Building Manager",
      description: "Grand Residency Hotel only",
      buildings: ["GRH"], home: "building",
      pages: ["building", "system", "faults", "insights", "reports"]
    },
    {
      username: "operator", name: "Control Room", role: "Control Room Operator",
      description: "All buildings, alarms and faults",
      buildings: "ALL", home: "faults",
      pages: ["overview", "building", "system", "faults", "insights", "reports"]
    }
  ];
  const PASSWORD = "demo";
  const KEY = "eh-user";

  function store(user) { try { sessionStorage.setItem(KEY, user ? user.username : ""); } catch (e) {} }

  DEMO.auth = {
    users: USERS,
    current: null,
    restore() {
      let name = null;
      try { name = sessionStorage.getItem(KEY); } catch (e) {}
      this.current = USERS.find((u) => u.username === name) || null;
      return this.current;
    },
    login(username, password) {
      const u = USERS.find((x) => x.username === String(username || "").trim().toLowerCase());
      if (!u || password !== PASSWORD) return null;
      this.current = u; store(u); return u;
    },
    loginAs(username) {
      const u = USERS.find((x) => x.username === username);
      this.current = u; store(u); return u;
    },
    logout() { this.current = null; store(null); },
    canSee(buildingId) {
      const u = this.current; if (!u) return false;
      return u.buildings === "ALL" || u.buildings.includes(buildingId);
    },
    initials(u) { return u.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase(); }
  };
})();
