/* =========================================================================
   data.js - the demo portfolio: buildings, systems, tariffs and the
   problems ("waste") planted in the simulated data.
   All figures are invented for the demo. Nothing here is real data.
   ========================================================================= */

window.DEMO = window.DEMO || {};

/* Company details printed on PDF reports. Replace with the real company name and logo.
   logo: a PNG as a data URI ("data:image/png;base64,..."), or null to use the built-in mark. */
DEMO.COMPANY = {
  name: "Your Company Name Pvt. Ltd.",
  division: "Facilities & Energy Management",
  address: "Corporate Office, Chennai, India",
  logo: null
};

/* Systems shown on the dashboard. `group` = which band of the stacked chart. */
DEMO.SYSTEMS = [
  { id: "chiller",  name: "Chiller Plant",            short: "Chiller",     group: "chiller"  },
  { id: "airside",  name: "AHU / FCU",                short: "AHU / FCU",   group: "airside"  },
  { id: "lighting", name: "Lighting",                 short: "Lighting",    group: "lighting" },
  { id: "vent",     name: "Ventilation & Exhaust",    short: "Ventilation", group: "vent"     },
  { id: "vertical", name: "Elevators & Escalators",   short: "Vertical",    group: "vertical" },
  { id: "hotwater", name: "Hot Water / Heat Pumps",   short: "Hot water",   group: "other"    },
  { id: "water",    name: "Water Pumping",            short: "Pumping",     group: "other"    },
  { id: "cold",     name: "Cold Rooms",               short: "Cold rooms",  group: "other"    },
  { id: "ups",      name: "UPS Losses",               short: "UPS losses",  group: "other"    },
  { id: "plants",   name: "STP / WTP",                short: "STP / WTP",   group: "other"    },
  { id: "kitchen",  name: "Kitchen, Laundry & Pool",  short: "Kitchen etc.",group: "other"    },
  { id: "plug",     name: "Sockets, IT & Tenants",    short: "Sockets / IT",group: "other"    }
];

/* Bands of the stacked load chart (max 6, fixed colour order). */
DEMO.GROUPS = [
  { id: "chiller",  name: "Chiller plant" },
  { id: "airside",  name: "AHU / FCU" },
  { id: "lighting", name: "Lighting" },
  { id: "vent",     name: "Ventilation" },
  { id: "vertical", name: "Elevators & escalators" },
  { id: "other",    name: "All other systems" }
];

/* Electricity tariff, time-of-day (Rs per kWh). Indicative commercial rates. */
DEMO.TARIFF = {
  normal: 9.0,      // 06:00 - 18:00
  peak: 10.8,       // 18:00 - 22:00 (+20%)
  offPeak: 7.65,    // 22:00 - 06:00 (-15%)
  diesel: 28.0      // DG power, Rs per kWh
};
DEMO.tariffAt = function (hour) {
  if (hour >= 18 && hour < 22) return DEMO.TARIFF.peak;
  if (hour >= 22 || hour < 6) return DEMO.TARIFF.offPeak;
  return DEMO.TARIFF.normal;
};

/* The three demo buildings. */
DEMO.BUILDINGS = [
  {
    id: "TPA",
    name: "Tech Park Tower A",
    type: "Office",
    city: "Bengaluru",
    areaM2: 24000,
    floors: 8,
    hoursText: "Mon-Fri 08:00-20:00, Sat 09:00-14:00",
    climate: { tMin: 20, tMax: 30 },
    meterStart: 18442310,
    chiller: { units: 2, unitTR: 300, base: 0.10, occW: 0.62, tempW: 0.30, kwPerTR: 0.84, dT: 3.4 },
    loads: {
      airside: 190, lighting: 168, vent: 38, vertical: 36, hotwater: 9, water: 14,
      cold: 7, upsOut: 22, upsEff: 0.88, plants: 17, kitchen: 32, plug: 150
    },
    solarKWp: 150,
    systems: ["chiller","airside","lighting","vent","vertical","hotwater","water","cold","ups","plants","kitchen","plug"]
  },
  {
    id: "GRH",
    name: "Grand Residency Hotel",
    type: "Hotel",
    city: "Chennai",
    areaM2: 18000,
    floors: 8,
    rooms: 120,
    hoursText: "24/7, 120 guest rooms",
    climate: { tMin: 25, tMax: 34 },
    meterStart: 26118904,
    chiller: { units: 2, unitTR: 250, base: 0.34, occW: 0.30, tempW: 0.28, kwPerTR: 0.68, dT: 5.3 },
    loads: {
      airside: 120, lighting: 95, vent: 42, vertical: 24, hotwater: 60, water: 18,
      cold: 16, upsOut: 16, upsEff: 0.93, plants: 24, kitchen: 150, plug: 70
    },
    solarKWp: 80,
    systems: ["chiller","airside","lighting","vent","vertical","hotwater","water","cold","ups","plants","kitchen","plug"]
  },
  {
    id: "CSM",
    name: "City Square Mall",
    type: "Mall",
    city: "Hyderabad",
    areaM2: 45000,
    floors: 5,
    hoursText: "Daily 10:00-22:00",
    climate: { tMin: 22, tMax: 33 },
    meterStart: 41907755,
    chiller: { units: 3, unitTR: 400, base: 0.06, occW: 0.62, tempW: 0.30, kwPerTR: 0.71, dT: 5.1 },
    loads: {
      airside: 300, lighting: 520, vent: 70, vertical: 72, hotwater: 6, water: 22,
      cold: 20, upsOut: 26, upsEff: 0.94, plants: 26, kitchen: 120, plug: 380
    },
    solarKWp: 300,
    systems: ["chiller","airside","lighting","vent","vertical","hotwater","water","cold","ups","plants","kitchen","plug"]
  }
];

DEMO.KPI_TARGETS = {
  plantKwPerTR: 0.65,      // whole chiller plant, kW per TR
  chwDeltaT: 5.5,          // chilled water design ΔT, C
  upsEff: 0.94,            // UPS efficiency
  hwTankSetpoint: 60,      // hot water storage, C (Legionella-safe)
  stpDO: 2.0,              // STP dissolved oxygen target, mg/L
  co2Max: 1000, co2Min: 600
};

/* Planted problems. Each one adds `kw` to `system` while `active(h, dow)` is true.
   They are invisible in the raw view and surface as findings in the KPI view. */
DEMO.WASTE = [
  {
    id: "tpa-chiller-eff", building: "TPA", system: "chiller", severity: "critical",
    title: "Chiller plant running at low efficiency",
    detail: "Plant at {kwtr} kW/TR against a 0.65 target. Chilled water ΔT is only 3.4 °C (design 5.5 °C), so pumps move about 60% more water than needed.",
    action: "Rebalance the chilled water valves and reset the secondary pump pressure setpoint.",
    kind: "efficiency"   // kW computed from TR x (actual - target)
  },
  {
    id: "tpa-chiller-afterhours", building: "TPA", system: "chiller", severity: "warning",
    title: "Chiller plant runs 3 hours after the office closes",
    detail: "Plant schedule ends at 23:00, but the building closes at 20:00 on weekdays.",
    action: "Change the plant stop time to 20:00 on weekdays.",
    kind: "schedule", active: (h, d) => d >= 1 && d <= 5 && h >= 20 && h < 23, kw: 118
  },
  {
    id: "tpa-ahu-247", building: "TPA", system: "airside", severity: "warning",
    title: "AHU-06 and AHU-07 running 24/7",
    detail: "Both units serve floors 6-7, which are empty outside office hours.",
    action: "Put AHU-06 and AHU-07 back on the office-hours schedule.",
    kind: "fixed", active: (h, d) => !(d >= 1 && d <= 5 && h >= 8 && h < 20), kw: 26
  },
  {
    id: "tpa-lights-f5", building: "TPA", system: "lighting", severity: "warning",
    title: "Floor 5 lights left on overnight",
    detail: "Open-office lighting on floor 5 stays on with no occupancy detected.",
    action: "Link floor 5 lighting to the occupancy sensors and the building schedule.",
    kind: "fixed", active: (h) => h >= 21 || h < 7, kw: 21
  },
  {
    id: "tpa-stp-do", building: "TPA", system: "plants", severity: "info",
    title: "STP over-aeration",
    detail: "Dissolved oxygen at 3.6 mg/L against a 2.0 mg/L target. Blowers run harder than needed.",
    action: "Lower the blower DO setpoint to 2.0 mg/L.",
    kind: "fixed", active: () => true, kw: 3.2
  },
  {
    id: "tpa-ups-low", building: "TPA", system: "ups", severity: "info",
    title: "UPS running at 18% load (88% efficient)",
    detail: "Two 120 kVA UPS units share a 22 kW critical load. Efficiency drops sharply at low load.",
    action: "Run one UPS module, or enable eco mode where the IT team allows.",
    kind: "fixed", active: () => true, kw: 1.6
  },
  {
    id: "grh-unsold-ac", building: "GRH", system: "airside", severity: "warning",
    title: "AC running in 9 unsold guest rooms",
    detail: "GRMS shows rooms 304, 311, 318, 402, 415, 506, 512, 603 and 619 unsold, with AC on at 22 °C.",
    action: "Set unsold rooms to 28 °C setback through the GRMS, linked to the PMS.",
    kind: "fixed", active: () => true, kw: 9.5
  },
  {
    id: "grh-hw-overheat", building: "GRH", system: "hotwater", severity: "info",
    title: "Hot water stored at 68 °C (setpoint 60 °C)",
    detail: "Storage tanks are heated 8 °C above the Legionella-safe setpoint, raising standby losses.",
    action: "Return the tank setpoint to 60 °C. Do not go below 60 °C.",
    kind: "fixed", active: () => true, kw: 5.5
  },
  {
    id: "grh-coldroom-door", building: "GRH", system: "cold", severity: "info",
    title: "Kitchen cold room door left open",
    detail: "Cold room 2 door open for long periods during lunch and dinner prep.",
    action: "Fit a door alarm and strip curtain on cold room 2.",
    kind: "fixed", active: (h) => (h >= 12 && h < 13) || (h >= 19 && h < 20), kw: 4
  },
  {
    id: "csm-facade", building: "CSM", system: "lighting", severity: "warning",
    title: "Facade and signage lights on after sunrise",
    detail: "Facade lighting stays on until 09:30. The photocell should switch it off at sunrise (about 06:15).",
    action: "Fix the photocell / astronomical timer on the facade circuit.",
    kind: "fixed", active: (h) => h >= 6.25 && h < 9.5, kw: 46
  },
  {
    id: "csm-carpark-fans", building: "CSM", system: "vent", severity: "warning",
    title: "Car park fans at full speed while the mall is closed",
    detail: "Jet fans run at 100% overnight while CO reads 3-5 ppm (limit 25 ppm).",
    action: "Enable CO-based speed control on the car park fans.",
    kind: "fixed", active: (h) => h >= 23 || h < 9, kw: 40
  },
  {
    id: "csm-escalators", building: "CSM", system: "vertical", severity: "info",
    title: "Escalators running empty after closing",
    detail: "8 escalators run at full speed from 22:00 to 23:30 with no footfall.",
    action: "Stop escalators at 22:15, or use slow mode with passenger detection.",
    kind: "fixed", active: (h) => h >= 22 && h < 23.5, kw: 44
  }
];
