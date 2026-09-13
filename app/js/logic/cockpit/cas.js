/*
  CAS / annunciator domain — port of domain/instruments/cas/{CasCatalog, CasAircraftProfileCatalog,
  CasSystem (TrainingCasPolicy, TrainingDefault sorting), CasController masters,
  FailureStateEvaluator, FailureEffectRegistry, G950CasResolver, LegacyAnnunciationResolver}
  and the scenario-snapshot startup sets (ScenarioPhaseSnapshotRenderer.kt).
*/

export const PRIORITY_RANK = { WARNING: 4, CAUTION: 3, ADVISORY: 2, STATUS: 1 };

const SPEC_LIST = [
  ["BAGGAGE_SMOKE", "BAGGAGE SMOKE", "WARNING", true, false], ["MSTR_WARN_TEST", "MSTR WARN TEST", "WARNING"], ["L_FIRE_DETECT_CB", "L FIRE DETECT CB", "WARNING"],
  ["R_FIRE_DETECT_CB", "R FIRE DETECT CB", "WARNING"], ["L_ENG_FIRE", "L ENG FIRE", "WARNING", true, false], ["R_ENG_FIRE", "R ENG FIRE", "WARNING", true, false],
  ["AFT_BOOST1_PR", "AFT BOOST1 PR", "CAUTION"], ["AFT_BOOST2_PR", "AFT BOOST2 PR", "CAUTION"], ["AFT_FUEL_LOW", "AFT FUEL LOW", "CAUTION"], ["AC_400_CYCLE", "400 CYCLE", "CAUTION"],
  ["DOORS_UNLOCKED", "DOORS UNLOCKED", "CAUTION"], ["DUCT_OVERHEAT", "DUCT OVERHEAT", "CAUTION"], ["FWD_BOOST1_PR", "FWD BOOST1 PR", "CAUTION"], ["FWD_BOOST2_PR", "FWD BOOST2 PR", "CAUTION"],
  ["FWD_FUEL_LOW", "FWD FUEL LOW", "CAUTION"], ["HYD_PUMP_CB", "HYD PUMP CB", "CAUTION"], ["L_CHIP_DETECT", "L CHIP DETECT", "CAUTION"], ["L_GEN_FAIL", "L GEN FAIL", "CAUTION"],
  ["L_GEN_OVHT", "L GEN OVHT", "CAUTION"], ["L_OIL_PRESS", "L OIL PRESS", "CAUTION"], ["L_PITOT_HT_FAIL", "L PITOT HT FAIL", "CAUTION"], ["L_PITOT_HT_OFF", "L PITOT HT OFF", "CAUTION"],
  ["L_RFUEL_VLV_OPN", "L RFUEL VLV OPN", "CAUTION"], ["L_TNK_PMP_FAIL", "L TNK PMP FAIL", "CAUTION"], ["LRG_MAG_VAR", "LRG MAG VAR", "CAUTION"], ["MSTR_CAUT_TEST", "MSTR CAUT TEST", "CAUTION"],
  ["PNU_LOW_PRESS_AIR", "PNU LOW PRESS", "CAUTION"], ["BETA_BCKP_DSRM", "BETA BCKP DSRM", "CAUTION"], ["R_GEN_FAIL", "R GEN FAIL", "CAUTION"], ["R_GEN_OVHT", "R GEN OVHT", "CAUTION"],
  ["R_CHIP_DETECT", "R CHIP DETECT", "CAUTION"], ["R_OIL_PRESS", "R OIL PRESS", "CAUTION"], ["R_PITOT_HT_FAIL", "R PITOT HT FAIL", "CAUTION"], ["R_PITOT_HT_OFF", "R PITOT HT OFF", "CAUTION"],
  ["R_RFUEL_VLV_OPN", "R RFUEL VLV OPN", "CAUTION"], ["R_TNK_PMP_FAIL", "R TNK PMP FAIL", "CAUTION"], ["RESET_PROPS", "RESET PROPS", "CAUTION"], ["SLCT_MAG", "SLCT MAG", "CAUTION"],
  ["SLCT_NON_MAG", "SLCT NON-MAG", "CAUTION"],
  ["CHECK_STANDBY", "CHECK STANDBY", "ADVISORY"], ["L_FIRE_DETECT_FAIL", "L FIRE DETECT FAIL", "ADVISORY"], ["MFD_FAN_FAIL", "MFD FAN FAIL", "ADVISORY"], ["PFD_1_FAN_FAIL", "PFD 1 FAN FAIL", "ADVISORY"],
  ["PFD_2_FAN_FAIL", "PFD 2 FAN FAIL", "ADVISORY"], ["PNU_LOW_PRESS_GND", "PNU LOW PRESS", "ADVISORY"], ["R_FIRE_DETECT_FAIL", "R FIRE DETECT FAIL", "ADVISORY"],
  ["L_INTAKE_DFLCTR", "L INTAKE DFLCTR", "STATUS"], ["L_PROP_BETA", "L PROP BETA", "STATUS"], ["L_STAB_DEICE_PR", "L STAB DEICE PR", "STATUS"], ["L_WING_TANK_PUMP", "L WING TANK PUMP", "STATUS"],
  ["R_INTAKE_DFLCTR", "R INTAKE DFLCTR", "STATUS"], ["R_PROP_BETA", "R PROP BETA", "STATUS"], ["R_STAB_DEICE_PR", "R STAB DEICE PR", "STATUS"], ["R_WING_TANK_PUMP", "R WING TANK PUMP", "STATUS"],
  ["L_AVIONICS_FAN_FAIL", "L AVIONICS FAN FAIL", "ADVISORY"], ["R_AVIONICS_FAN_FAIL", "R AVIONICS FAN FAIL", "ADVISORY"]
];
export const CAS_SPECS = {};
SPEC_LIST.forEach(function (row) { CAS_SPECS[row[0]] = { stableId: row[0], text: row[1], priority: row[2], latched: Boolean(row[3]), ackAllowed: row[4] !== false }; });

const STATIC_ALIASES = {
  "ENGINE_ENGINE_L FIRE": "L_ENG_FIRE", ENGINE_FIRE_R: "R_ENG_FIRE", ENGINE_FIRE: "L_ENG_FIRE", "ENG_ENGINE_L FIRE": "L_ENG_FIRE", ENG_FIRE_R: "R_ENG_FIRE",
  GEN_FAIL_L: "L_GEN_FAIL", GEN_FAIL_R: "R_GEN_FAIL", GEN_OVHT_L: "L_GEN_OVHT", GEN_OVHT_R: "R_GEN_OVHT", L_GENERATOR_OVERHEAT: "L_GEN_OVHT", R_GENERATOR_OVERHEAT: "R_GEN_OVHT",
  L_GENERATOR: "L_GEN_FAIL", R_GENERATOR: "R_GEN_FAIL", L_ENGINE_OIL_PRESS: "L_OIL_PRESS", OIL_PRESS_R: "R_OIL_PRESS", L_OIL_PRESS_CAS: "L_OIL_PRESS", OIL_PRESS_R_CAS: "R_OIL_PRESS",
  CHIP_DETECT_L: "L_CHIP_DETECT", CHIP_DETECT_R: "R_CHIP_DETECT", PITOT_HEAT_FAIL_L: "L_PITOT_HT_FAIL", PITOT_HEAT_FAIL_R: "R_PITOT_HT_FAIL", PITOT_HEAT_OFF_L: "L_PITOT_HT_OFF", PITOT_HEAT_OFF_R: "R_PITOT_HT_OFF",
  RFUEL_VALVE_OPEN_L: "L_RFUEL_VLV_OPN", RFUEL_VALVE_OPEN_R: "R_RFUEL_VLV_OPN", TANK_PUMP_FAIL_L: "L_TNK_PMP_FAIL", TANK_PUMP_FAIL_R: "R_TNK_PMP_FAIL",
  BOOST1_PRESS_AFT: "AFT_BOOST1_PR", BOOST2_PRESS_AFT: "AFT_BOOST2_PR", BOOST1_PRESS_FWD: "FWD_BOOST1_PR", BOOST2_PRESS_FWD: "FWD_BOOST2_PR",
  BOOST_PUMP_1_AFT_PRESS: "AFT_BOOST1_PR", BOOST_PUMP_2_AFT_PRESS: "AFT_BOOST2_PR", BOOST_PUMP_1_FWD_PRESS: "FWD_BOOST1_PR", BOOST_PUMP_2_FWD_PRESS: "FWD_BOOST2_PR",
  FUEL_LOW_AFT: "AFT_FUEL_LOW", FUEL_LOW_FWD: "FWD_FUEL_LOW", AFT_FUEL_LOW_LEVEL: "AFT_FUEL_LOW", FWD_FUEL_LOW_LEVEL: "FWD_FUEL_LOW",
  BETA_BACKUP_DISARMED: "BETA_BCKP_DSRM", BETA_BCKP_DSRM: "BETA_BCKP_DSRM", BETA_MODE_L: "L_PROP_BETA", BETA_MODE_R: "R_PROP_BETA", PROP_BETA_L: "L_PROP_BETA", PROP_BETA_R: "R_PROP_BETA",
  INTAKE_DEFLECTOR_L: "L_INTAKE_DFLCTR", INTAKE_DEFLECTOR_R: "R_INTAKE_DFLCTR", STAB_DEICE_PRESS_L: "L_STAB_DEICE_PR", STAB_DEICE_PRESS_R: "R_STAB_DEICE_PR",
  WING_TANK_PUMP_L: "L_WING_TANK_PUMP", WING_TANK_PUMP_R: "R_WING_TANK_PUMP", PNEUMATIC_LOW_PRESS_AIR: "PNU_LOW_PRESS_AIR", PNEUMATIC_LOW_PRESS_GROUND: "PNU_LOW_PRESS_GND",
  PNEUMATIC_LOW_PRESS: "PNU_LOW_PRESS_AIR", PNEUMATIC_LOW_PRESSURE: "PNU_LOW_PRESS_AIR", PNU_LOW_PRESS: "PNU_LOW_PRESS_AIR", DUCT_OVERHEAD: "DUCT_OVERHEAT", DUCT_OVERHEAT_LIGHT: "DUCT_OVERHEAT",
  RESET_PROPS_LIGHT: "RESET_PROPS", FIRE_DETECT_FAIL_L: "L_FIRE_DETECT_FAIL", FIRE_DETECT_FAIL_R: "R_FIRE_DETECT_FAIL", FIRE_DETECT_CB_L: "L_FIRE_DETECT_CB", FIRE_DETECT_CB_R: "R_FIRE_DETECT_CB",
  MSTR_CAUT_TEST: "MSTR_CAUT_TEST", MASTER_CAUTION_TEST: "MSTR_CAUT_TEST", MASTER_CAUT_TEST: "MSTR_CAUT_TEST", MSTR_CAUTION_TEST: "MSTR_CAUT_TEST",
  "400_CYCLE_LIGHT": "AC_400_CYCLE", FOUR_HUNDRED_CYCLE_LIGHT: "AC_400_CYCLE", DOOR_UNLOCKED: "DOORS_UNLOCKED", DOORS_UNLOCKED: "DOORS_UNLOCKED",
  R_ENGINE_OIL_PRESS: "R_OIL_PRESS", HYDRAULIC_PUMP_CB: "HYD_PUMP_CB", MFD_FAN: "MFD_FAN_FAIL", PFD1_FAN: "PFD_1_FAN_FAIL", PFD2_FAN: "PFD_2_FAN_FAIL",
  AVIONICS_FAN_L: "L_AVIONICS_FAN_FAIL", AVIONICS_FAN_R: "R_AVIONICS_FAN_FAIL"
};

/* CasAircraftProfileCatalog — legacy (Title Case) and G950 (upper) entries. */
export const LEGACY_PROFILE = [
  ["MSTR_CAUT_TEST", "Mstr Caut Test", "CAUTION", ["MSTR CAUT TEST", "MASTER CAUTION TEST", "Mstr Caut Test (caution)"]],
  ["AC_400_CYCLE", "400 cycle light", "CAUTION", ["400 CYCLE", "400 cycle light (caution)", "FOUR HUNDRED CYCLE LIGHT"]],
  ["DOORS_UNLOCKED", "Doors Unlocked", "CAUTION", ["DOORS UNLOCKED", "doors_unlocked", "doors_unlocked (caution)", "DOOR UNLOCKED"]],
  ["L_GEN_FAIL", "L Gen Fail", "CAUTION", ["L GEN FAIL", "L Gen Fail (caution)", "L GENERATOR", "LEFT GENERATOR"]],
  ["R_GEN_FAIL", "R Gen Fail", "CAUTION", ["R GEN FAIL", "R Gen Fail (caution)", "R GENERATOR", "RIGHT GENERATOR"]],
  ["L_GEN_OVHT", "L Gen Ovht", "CAUTION", ["L GEN OVHT", "L Gen Ovht (caution)", "LEFT GENERATOR OVERHEAT", "L GEN OVERHEAT"]],
  ["R_GEN_OVHT", "R Gen Ovht", "CAUTION", ["R GEN OVHT", "R Gen Ovht (caution)", "RIGHT GENERATOR OVERHEAT", "R GEN OVERHEAT"]],
  ["L_OIL_PRESS", "L Oil Press", "CAUTION", ["L OIL PRESS", "L Oil Press (caution)", "L ENGINE OIL PRESS", "LEFT OIL PRESS"]],
  ["R_OIL_PRESS", "R Oil Press", "CAUTION", ["R OIL PRESS", "R Oil Press (caution)", "R ENGINE OIL PRESS", "RIGHT OIL PRESS"]],
  ["L_CHIP_DETECT", "L Chip Detect", "CAUTION", ["L CHIP DETECT", "L Chip Detect (caution)", "LEFT CHIP DETECT"]],
  ["R_CHIP_DETECT", "R Chip Detect", "CAUTION", ["R CHIP DETECT", "R Chip Detect (caution)", "RIGHT CHIP DETECT"]],
  ["RESET_PROPS", "Reset Props", "CAUTION", ["RESET PROPS", "Reset Props (caution)", "RESET PROPS LIGHT"]],
  ["AFT_BOOST1_PR", "Aft Boost1 Pr", "CAUTION", ["AFT BOOST1 PR", "Aft Boost1 Pr (caution)", "AFT BOOST 1 PR", "BOOST PUMP 1 AFT PRESS"]],
  ["AFT_BOOST2_PR", "Aft Boost2 Pr", "CAUTION", ["AFT BOOST2 PR", "Aft Boost2 Pr (caution)", "AFT BOOST 2 PR", "BOOST PUMP 2 AFT PRESS"]],
  ["FWD_BOOST1_PR", "Fwd Boost1 Pr", "CAUTION", ["FWD BOOST1 PR", "Fwd Boost1 Pr (caution)", "FWD BOOST 1 PR", "BOOST PUMP 1 FWD PRESS"]],
  ["FWD_BOOST2_PR", "Fwd Boost2 Pr", "CAUTION", ["FWD BOOST2 PR", "Fwd Boost2 Pr (caution)", "FWD BOOST 2 PR", "BOOST PUMP 2 FWD PRESS"]],
  ["AFT_FUEL_LOW", "Aft Fuel Low", "CAUTION", ["AFT FUEL LOW", "Aft Fuel Low (caution)"]],
  ["FWD_FUEL_LOW", "Fwd Fuel Low", "CAUTION", ["FWD FUEL LOW", "Fwd Fuel Low (caution)"]],
  ["HYD_PUMP_CB", "Hyd Pump CB", "CAUTION", ["HYD PUMP CB", "Hyd Pump CB (caution)", "HYDRAULIC PUMP CB"]],
  ["DUCT_OVERHEAT", "Duct Overheat", "CAUTION", ["DUCT OVERHEAT", "Duct Overheat (caution)"]],
  ["PNU_LOW_PRESS", "Pnu Low Press", "CAUTION", ["PNU LOW PRESS", "Pnu Low Press (caution)", "PNEUMATIC LOW PRESSURE"]],
  ["BETA_BCKP_DSRM", "Beta Bckp Dsrm", "CAUTION", ["BETA BCKP DSRM", "Beta Bckp Dsrm (caution)", "BETA BACKUP DISARMED"]],
  ["L_PITOT_HT_FAIL", "L Pitot Ht Fail", "CAUTION", ["L PITOT HT FAIL", "L Pitot Ht Fail (caution)", "LEFT PITOT HEAT FAIL"]],
  ["R_PITOT_HT_FAIL", "R Pitot Ht Fail", "CAUTION", ["R PITOT HT FAIL", "R Pitot Ht Fail (caution)", "RIGHT PITOT HEAT FAIL"]],
  ["L_PITOT_HT_OFF", "L Pitot Ht Off", "CAUTION", ["L PITOT HT OFF", "L Pitot Ht Off (caution)", "LEFT PITOT HEAT OFF"]],
  ["R_PITOT_HT_OFF", "R Pitot Ht Off", "CAUTION", ["R PITOT HT OFF", "R Pitot Ht Off (caution)", "RIGHT PITOT HEAT OFF"]],
  ["L_RFUEL_VLV_OPN", "L Refuel Vlv Open", "CAUTION", ["L RFUEL VLV OPN", "L Refuel Vlv Open (caution)", "LEFT REFUEL VALVE OPEN"]],
  ["R_RFUEL_VLV_OPN", "R Refuel Vlv Open", "CAUTION", ["R RFUEL VLV OPN", "R Refuel Vlv Open (caution)", "RIGHT REFUEL VALVE OPEN"]],
  ["L_TNK_PMP_FAIL", "L Tnk Pmp Fail", "CAUTION", ["L TNK PMP FAIL", "L Tnk Pmp Fail (caution)", "LEFT TANK PUMP FAIL"]],
  ["R_TNK_PMP_FAIL", "R Tnk Pmp Fail", "CAUTION", ["R TNK PMP FAIL", "R Tnk Pmp Fail (caution)", "RIGHT TANK PUMP FAIL"]]
].map(function (r) { return { stableId: r[0], displayText: r[1], priority: r[2], aliases: r[3] }; });

export const G950_PROFILE = [
  ["BAGGAGE_SMOKE", "WARNING"], ["MSTR_WARN_TEST", "WARNING"], ["L_FIRE_DETECT_CB", "WARNING"], ["R_FIRE_DETECT_CB", "WARNING"], ["L_ENG_FIRE", "WARNING"], ["R_ENG_FIRE", "WARNING"],
  ["MSTR_CAUT_TEST", "CAUTION", ["Mstr Caut Test (caution)", "MASTER CAUTION TEST"]], ["AFT_BOOST1_PR", "CAUTION"], ["AFT_BOOST2_PR", "CAUTION"], ["AFT_FUEL_LOW", "CAUTION"], ["DOORS_UNLOCKED", "CAUTION"],
  ["DUCT_OVERHEAT", "CAUTION"], ["FWD_BOOST1_PR", "CAUTION"], ["FWD_BOOST2_PR", "CAUTION"], ["FWD_FUEL_LOW", "CAUTION"], ["HYD_PUMP_CB", "CAUTION"], ["L_CHIP_DETECT", "CAUTION"], ["L_GEN_FAIL", "CAUTION"],
  ["L_GEN_OVHT", "CAUTION"], ["L_OIL_PRESS", "CAUTION"], ["L_PITOT_HT_FAIL", "CAUTION"], ["L_PITOT_HT_OFF", "CAUTION"], ["L_RFUEL_VLV_OPN", "CAUTION"], ["L_TNK_PMP_FAIL", "CAUTION"], ["LRG_MAG_VAR", "CAUTION"],
  ["PNU_LOW_PRESS", "CAUTION"], ["BETA_BCKP_DSRM", "CAUTION"], ["R_GEN_FAIL", "CAUTION"], ["R_GEN_OVHT", "CAUTION"], ["R_CHIP_DETECT", "CAUTION"], ["R_OIL_PRESS", "CAUTION"], ["R_PITOT_HT_FAIL", "CAUTION"],
  ["R_PITOT_HT_OFF", "CAUTION"], ["R_RFUEL_VLV_OPN", "CAUTION"], ["R_TNK_PMP_FAIL", "CAUTION"], ["RESET_PROPS", "CAUTION"], ["SLCT_MAG", "CAUTION"], ["SLCT_NON_MAG", "CAUTION", null, "SLCT NON-MAG"],
  ["CHECK_STANDBY", "ADVISORY"], ["L_FIRE_DETECT_FAIL", "ADVISORY"], ["MFD_FAN_FAIL", "ADVISORY"], ["PFD_1_FAN_FAIL", "ADVISORY"], ["PFD_2_FAN_FAIL", "ADVISORY"], ["PNU_LOW_PRESS_GND", "ADVISORY", null, "PNU LOW PRESS"],
  ["R_FIRE_DETECT_FAIL", "ADVISORY"], ["L_INTAKE_DFLCTR", "STATUS"], ["L_PROP_BETA", "STATUS"], ["L_STAB_DEICE_PR", "STATUS"], ["L_WING_TANK_PUMP", "STATUS"], ["R_INTAKE_DFLCTR", "STATUS"],
  ["R_PROP_BETA", "STATUS"], ["R_STAB_DEICE_PR", "STATUS"], ["R_WING_TANK_PUMP", "STATUS"]
].map(function (r) { return { stableId: r[0], displayText: r[3] || r[0].replace(/_/g, " "), priority: r[1], aliases: r[2] || [] }; });

export function canonicalAliasKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\((WARNING|CAUTION|ADVISORY|STATUS)\)/g, "").replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/* aliasOverrides(): the operator custom profile (= legacy entries) — alias/displayText/stableId → stableId. */
const PROFILE_ALIASES = {};
LEGACY_PROFILE.forEach(function (e) { e.aliases.concat([e.displayText, e.stableId]).forEach(function (a) { PROFILE_ALIASES[canonicalAliasKey(a)] = e.stableId; }); });

const SIDE_MAP = { ENGINE_FIRE: "ENG_FIRE", GEN_FAIL: "GEN_FAIL", GEN_OVHT: "GEN_OVHT", OIL_PRESS: "OIL_PRESS", CHIP_DETECT: "CHIP_DETECT", PITOT_HT_FAIL: "PITOT_HT_FAIL",
  PITOT_HT_OFF: "PITOT_HT_OFF", RFUEL_VLV_OPN: "RFUEL_VLV_OPN", TNK_PMP_FAIL: "TNK_PMP_FAIL", BETA_MODE: "PROP_BETA" };

/* CasCatalog.normalize(eventId, side, airGround) → { stableId, priority, text } */
export function normalizeCas(eventId, side, airGround) {
  const raw = String(eventId || "").trim().toUpperCase();
  const s = side ? String(side).trim().toUpperCase() : null;
  let stableId;
  if (SIDE_MAP[raw] && (s === "L" || s === "R")) stableId = s + "_" + SIDE_MAP[raw];
  else if (raw === "PNU_LOW_PRESS" && String(airGround || "").toUpperCase() === "GROUND") stableId = "PNU_LOW_PRESS_GND";
  else if (raw === "PNU_LOW_PRESS") stableId = "PNU_LOW_PRESS_AIR";
  else {
    const sideKey = s ? raw + "_" + s : raw;
    stableId = PROFILE_ALIASES[canonicalAliasKey(sideKey)] || PROFILE_ALIASES[canonicalAliasKey(raw)] || STATIC_ALIASES[sideKey] || STATIC_ALIASES[raw] || raw;
  }
  const spec = CAS_SPECS[stableId];
  return { stableId: stableId, priority: spec ? spec.priority : "ADVISORY", text: spec ? spec.text : stableId.replace(/_/g, " ") };
}

export function casSpecFor(id) { return CAS_SPECS[String(id || "").trim().toUpperCase()] || null; }

/* Catalog rows for the Edit State annunciator picker (profiles() distinctBy stableId, legacy first). */
export function annunciatorCatalog() {
  const seen = new Set();
  const out = [];
  LEGACY_PROFILE.concat(G950_PROFILE).forEach(function (e) { if (!seen.has(e.stableId)) { seen.add(e.stableId); out.push(e); } });
  return out.sort(function (a, b) { return (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]) || a.displayText.localeCompare(b.displayText); });
}

/* ------------------------------------------------------------ CasSystem */
export function createCasSystem(opts) {
  const now = (opts && opts.now) || function () { return Date.now(); };
  const context = (opts && opts.context) || {};
  const states = new Map();
  let snapshot = [];
  function isLatched(id) { const spec = CAS_SPECS[id]; return spec ? spec.latched : id === "ENGINE_FIRE"; }
  function isInhibited(id, priority) {
    const phase = context.phase ? String(context.phase).toUpperCase().trim() : "";
    if (!phase) return false;
    return phase === "TAKEOFF" && (priority === "ADVISORY" || priority === "STATUS");
  }
  function isAckAllowed(id) { const spec = CAS_SPECS[id]; return spec ? spec.ackAllowed : id !== "ENGINE_FIRE"; }
  function emit() {
    const msgs = [];
    states.forEach(function (s) { if (s.active && !s.inhibited) msgs.push({ key: { id: s.id, side: null }, text: s.text, priority: s.priority, active: s.active, acknowledged: s.acknowledged, latched: s.latched, firstActivatedAtMillis: s.firstActivatedAt, lastChangedAtMillis: s.lastChangedAt }); });
    msgs.sort(function (a, b) { return (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]) || ((a.acknowledged ? 1 : 0) - (b.acknowledged ? 1 : 0)) || (b.firstActivatedAtMillis - a.firstActivatedAtMillis); });
    snapshot = msgs;
  }
  return {
    messages: function () { return snapshot; },
    clearAll: function () { states.clear(); emit(); },
    onEvent: function (event) {
      const rawId = String(event.id || "").trim().toUpperCase();
      if (rawId === "MASTER_WARNING" || rawId === "MASTER_CAUTION") return;
      const n = normalizeCas(event.id, event.side, context.airGround);
      const t = now();
      const spec = CAS_SPECS[n.stableId];
      const priority = spec ? spec.priority : (event.level === "WARNING" ? "WARNING" : event.level === "CAUTION" ? "CAUTION" : "ADVISORY");
      const inhibited = isInhibited(n.stableId, priority);
      const latched = spec ? spec.latched : isLatched(n.stableId);
      const prev = states.get(n.stableId);
      if (event.active) {
        states.set(n.stableId, { id: n.stableId, text: spec ? spec.text : n.text, priority: priority, active: !inhibited, inhibited: inhibited, acknowledged: prev ? prev.acknowledged : false,
          latched: latched, ackAllowed: spec ? spec.ackAllowed : isAckAllowed(n.stableId), firstActivatedAt: prev ? prev.firstActivatedAt : t, lastChangedAt: t, latchCleared: prev ? prev.latchCleared : false });
      } else {
        if (!prev) return;
        if (prev.latched && !prev.latchCleared) states.set(n.stableId, Object.assign({}, prev, { active: !inhibited, inhibited: inhibited, lastChangedAt: t }));
        else states.delete(n.stableId);
      }
      emit();
    },
    acknowledgeAll: function () { const t = now(); states.forEach(function (s, id) { if (s.ackAllowed || isAckAllowed(id)) { s.acknowledged = true; s.lastChangedAt = t; } }); emit(); },
    acknowledge: function (id) { const n = normalizeCas(id, null, context.airGround).stableId; const s = states.get(n); if (!s || !(s.ackAllowed || isAckAllowed(n))) return; s.acknowledged = true; s.lastChangedAt = now(); emit(); },
    clearLatched: function (id) { const n = normalizeCas(id, null, context.airGround).stableId; const s = states.get(n); if (!s || !s.latched) return; states.delete(n); emit(); }
  };
}

/* CasController — activeEvents + masters + CasSystem feed (annunciator bindings not needed for the plate). */
export function createCasController(casSystem) {
  const system = casSystem || createCasSystem();
  const active = new Map();
  function levelFor(priority) { return priority === "WARNING" ? "WARNING" : priority === "CAUTION" ? "CAUTION" : "ADVISORY"; }
  return {
    system: system,
    onCasEvent: function (event) {
      const n = normalizeCas(event.id, event.side, null);
      const normalizedEvent = { id: n.stableId, level: levelFor(n.priority), side: null, active: Boolean(event.active) };
      if (normalizedEvent.active) active.set(n.stableId, normalizedEvent); else active.delete(n.stableId);
      system.onEvent(normalizedEvent);
    },
    applySet: function (previousIds, nextIds) {
      const self = this;
      previousIds.forEach(function (id) { if (!nextIds.has(id)) self.onCasEvent({ id: id, active: false }); });
      nextIds.forEach(function (id) { if (!previousIds.has(id)) self.onCasEvent({ id: id, active: true }); });
      return new Set(nextIds);
    },
    clearAllMessages: function () { active.clear(); system.clearAll(); },
    masters: function () {
      let warn = false, caut = false;
      active.forEach(function (e) { if (e.active && e.level === "WARNING") warn = true; if (e.active && e.level === "CAUTION") caut = true; });
      return warn ? { warning: true, caution: false } : caut ? { warning: false, caution: true } : { warning: false, caution: false };
    }
  };
}

/* ------------------------------------------------ FailureStateEvaluator */
export const FAILURE_THRESHOLDS = {
  L_OIL_PRESS_LOW_PSI: 40, FUEL_LOW_LB: 250, HYD_LOW_PSI: 1200, GEN_AVAILABLE_NG: 58, GEN_OVHT_TORQUE: 44, GEN_OVHT_NG: 92, GEN_OVHT_NP: 90,
  RESET_PROPS_LOW_TORQUE: 12, RESET_PROPS_PROP_NOT_FWD: 0.97, BETA_GATE_FORWARD_01: 0.25, REVERSE_GATE_FORWARD_01: 0.18,
  FLAMEOUT_MIN_NG: 20, FLAMEOUT_MAX_FUEL_FLOW: 80, OVERTEMP_T5_C: 725, NG_OVERSPEED_LIMIT: 101.5, NP_OVERSPEED_LIMIT: 97,
  UNCOMMANDED_FEATHER_NP_MAX: 55, UNCOMMANDED_FEATHER_TORQUE_MIN: 12
};

export function evaluateFailures(i) {
  const T = FAILURE_THRESHOLDS;
  const p = [];
  function add(id) { if (p.indexOf(id) === -1) p.push(id); }
  const g = function (v, d) { return v == null ? d : v; };
  const wow = Boolean(i.wow);
  const lOil = g(i.leftOilPressurePsi, 0), rOil = g(i.rightOilPressurePsi, 0);
  const lNg = g(i.leftNgPercent, 0), rNg = g(i.rightNgPercent, 0), lNp = g(i.leftNpPercent, 0), rNp = g(i.rightNpPercent, 0);
  const lTq = g(i.leftTorquePsi, 0), rTq = g(i.rightTorquePsi, 0);
  const pL = g(i.powerLeverL01, 0.26), pR = g(i.powerLeverR01, 0.26), prL = g(i.propLeverL01, 1), prR = g(i.propLeverR01, 1);
  if (lOil >= 0 && lOil <= T.L_OIL_PRESS_LOW_PSI) add("L_OIL_PRESS");
  if (rOil >= 0 && rOil <= T.L_OIL_PRESS_LOW_PSI) add("R_OIL_PRESS");
  const lRev = wow && pL <= T.REVERSE_GATE_FORWARD_01, rRev = wow && pR <= T.REVERSE_GATE_FORWARD_01;
  const lBeta = wow && pL < T.BETA_GATE_FORWARD_01 && pL > T.REVERSE_GATE_FORWARD_01 && lNp < 96;
  const rBeta = wow && pR < T.BETA_GATE_FORWARD_01 && pR > T.REVERSE_GATE_FORWARD_01 && rNp < 96;
  if (i.leftGenFail || !i.leftGenOn || (lNg < T.GEN_AVAILABLE_NG && !(wow && (lBeta || lRev)))) add("L_GEN_FAIL");
  if (i.rightGenFail || !i.rightGenOn || (rNg < T.GEN_AVAILABLE_NG && !(wow && (rBeta || rRev)))) add("R_GEN_FAIL");
  if (i.leftGenOn && lNg >= T.GEN_OVHT_NG && lTq >= T.GEN_OVHT_TORQUE && lNp >= T.GEN_OVHT_NP) add("L_GEN_OVHT");
  if (i.rightGenOn && rNg >= T.GEN_OVHT_NG && rTq >= T.GEN_OVHT_TORQUE && rNp >= T.GEN_OVHT_NP) add("R_GEN_OVHT");
  if (g(i.fuelQtyFwdLb, 1000) <= T.FUEL_LOW_LB) add("FWD_FUEL_LOW");
  if (g(i.fuelQtyAftLb, 1000) <= T.FUEL_LOW_LB) add("AFT_FUEL_LOW");
  if (i.fwdBoostPump1PressureLow) add("FWD_BOOST1_PR");
  if (i.fwdBoostPump2PressureLow) add("FWD_BOOST2_PR");
  if (i.aftBoostPump1PressureLow) add("AFT_BOOST1_PR");
  if (i.aftBoostPump2PressureLow) add("AFT_BOOST2_PR");
  if (i.pneumaticPressureLow || g(i.hydraulicPressurePsi, 0) < T.HYD_LOW_PSI) add(wow ? "PNU_LOW_PRESS_GND" : "PNU_LOW_PRESS_AIR");
  if (lBeta) add("L_PROP_BETA");
  if (rBeta) add("R_PROP_BETA");
  if (lBeta || rBeta) add("BETA_BCKP_DSRM");
  if ((i.fuelOnLeft && lNg > T.GEN_AVAILABLE_NG && lTq <= T.RESET_PROPS_LOW_TORQUE && prL < T.RESET_PROPS_PROP_NOT_FWD) ||
    (i.fuelOnRight && rNg > T.GEN_AVAILABLE_NG && rTq <= T.RESET_PROPS_LOW_TORQUE && prR < T.RESET_PROPS_PROP_NOT_FWD)) add("RESET_PROPS");
  if (i.intakeDeflectorLeft) add("L_INTAKE_DFLCTR");
  if (i.intakeDeflectorRight) add("R_INTAKE_DFLCTR");
  if (i.stabDeiceLeft) add("L_STAB_DEICE_PR");
  if (i.stabDeiceRight) add("R_STAB_DEICE_PR");
  const lFf = g(i.leftFuelFlowPph, 0), rFf = g(i.rightFuelFlowPph, 0);
  if (!wow && i.fuelOnLeft && lNg >= 1 && lNg <= T.FLAMEOUT_MIN_NG && lFf <= T.FLAMEOUT_MAX_FUEL_FLOW) add("L_FLAMEOUT");
  if (!wow && i.fuelOnRight && rNg >= 1 && rNg <= T.FLAMEOUT_MIN_NG && rFf <= T.FLAMEOUT_MAX_FUEL_FLOW) add("R_FLAMEOUT");
  if (!wow && !i.fuelOnLeft && lNg < T.GEN_AVAILABLE_NG) add("L_SHUTDOWN_IN_FLIGHT");
  if (!wow && !i.fuelOnRight && rNg < T.GEN_AVAILABLE_NG) add("R_SHUTDOWN_IN_FLIGHT");
  if (g(i.leftT5Celsius, 0) > T.OVERTEMP_T5_C) add("L_T5_OVERTEMP");
  if (g(i.rightT5Celsius, 0) > T.OVERTEMP_T5_C) add("R_T5_OVERTEMP");
  if (lNg > T.NG_OVERSPEED_LIMIT) add("L_NG_OVERSPEED");
  if (rNg > T.NG_OVERSPEED_LIMIT) add("R_NG_OVERSPEED");
  if (lNp > T.NP_OVERSPEED_LIMIT) add("L_PROP_OVERSPEED");
  if (rNp > T.NP_OVERSPEED_LIMIT) add("R_PROP_OVERSPEED");
  if (!wow && i.fuelOnLeft && lTq >= T.UNCOMMANDED_FEATHER_TORQUE_MIN && lNp >= 1 && lNp <= T.UNCOMMANDED_FEATHER_NP_MAX && !i.autofeatherTriggeredLeft) add("L_UNCOMMANDED_FEATHER");
  if (!wow && i.fuelOnRight && rTq >= T.UNCOMMANDED_FEATHER_TORQUE_MIN && rNp >= 1 && rNp <= T.UNCOMMANDED_FEATHER_NP_MAX && !i.autofeatherTriggeredRight) add("R_UNCOMMANDED_FEATHER");
  if (!wow && i.fuelOnLeft && lTq < 0 && lNp > 70) add("L_PROP_REVERSAL");
  if (!wow && i.fuelOnRight && rTq < 0 && rNp > 70) add("R_PROP_REVERSAL");
  return { activeProfiles: p };
}

/* FailureEffectRegistry projection. */
const REGISTRY = {
  L_OIL_PRESS: { legacy: ["L_ENGINE_OIL_PRESS"], g950: ["L_OIL_PRESS"] }, R_OIL_PRESS: { legacy: ["R_ENGINE_OIL_PRESS"], g950: ["R_OIL_PRESS"] },
  L_GEN_FAIL: { legacy: ["L_GENERATOR"], g950: ["L_GEN_FAIL"] }, R_GEN_FAIL: { legacy: ["R_GENERATOR"], g950: ["R_GEN_FAIL"] },
  L_GEN_OVHT: { legacy: ["L_GENERATOR_OVERHEAT"], g950: ["L_GEN_OVHT"] }, R_GEN_OVHT: { legacy: ["R_GENERATOR_OVERHEAT"], g950: ["R_GEN_OVHT"] },
  FWD_BOOST1_PR: { legacy: ["BOOST_PUMP_1_FWD_PRESS"], g950: ["FWD_BOOST1_PR"] }, FWD_BOOST2_PR: { legacy: ["BOOST_PUMP_2_FWD_PRESS"], g950: ["FWD_BOOST2_PR"] },
  AFT_BOOST1_PR: { legacy: ["BOOST_PUMP_1_AFT_PRESS"], g950: ["AFT_BOOST1_PR"] }, AFT_BOOST2_PR: { legacy: ["BOOST_PUMP_2_AFT_PRESS"], g950: ["AFT_BOOST2_PR"] },
  FWD_FUEL_LOW: { legacy: ["FWD_FUEL_LOW_LEVEL"], g950: ["FWD_FUEL_LOW"] }, AFT_FUEL_LOW: { legacy: ["AFT_FUEL_LOW_LEVEL"], g950: ["AFT_FUEL_LOW"] },
  PNU_LOW_PRESS_AIR: { legacy: ["PNEUMATIC_LOW_PRESSURE"], g950: ["PNU_LOW_PRESS_AIR"] }, PNU_LOW_PRESS_GND: { legacy: ["PNEUMATIC_LOW_PRESSURE"], g950: ["PNU_LOW_PRESS_GND"] },
  BETA_BCKP_DSRM: { legacy: [], g950: ["BETA_BCKP_DSRM"] }, L_INTAKE_DFLCTR: { legacy: [], g950: ["L_INTAKE_DFLCTR"] }, R_INTAKE_DFLCTR: { legacy: [], g950: ["R_INTAKE_DFLCTR"] },
  L_PROP_BETA: { legacy: [], g950: ["L_PROP_BETA"] }, R_PROP_BETA: { legacy: [], g950: ["R_PROP_BETA"] }, L_STAB_DEICE_PR: { legacy: [], g950: ["L_STAB_DEICE_PR"] }, R_STAB_DEICE_PR: { legacy: [], g950: ["R_STAB_DEICE_PR"] },
  RESET_PROPS: { legacy: ["RESET_PROPS"], g950: ["RESET_PROPS"] }
};

export function resolveG950Cas(snapshot) {
  const out = [];
  snapshot.activeProfiles.forEach(function (p) { ((REGISTRY[p] || {}).g950 || []).forEach(function (id) { if (out.indexOf(id) === -1) out.push(id); }); });
  return out;
}
export function resolveLegacyAnnunciators(snapshot) {
  const out = [];
  snapshot.activeProfiles.forEach(function (p) { ((REGISTRY[p] || {}).legacy || []).forEach(function (id) { if (out.indexOf(id) === -1) out.push(id); }); });
  return out;
}

export const LEGACY_STARTUP_PANEL_ANNUNCIATORS = ["AC_400_CYCLE", "AFT_FUEL_LOW_LEVEL", "BLANK", "BOOST_PUMP_1_AFT_PRESS", "BOOST_PUMP_1_FWD_PRESS", "BOOST_PUMP_2_AFT_PRESS", "BOOST_PUMP_2_FWD_PRESS",
  "DOORS_UNLOCKED", "DUCT_OVERHEAT", "FWD_FUEL_LOW_LEVEL", "L_ENGINE_OIL_PRESS", "L_GENERATOR", "L_GENERATOR_OVERHEAT", "PNEUMATIC_LOW_PRESSURE", "RESET_PROPS", "R_ENGINE_OIL_PRESS", "R_GENERATOR", "R_GENERATOR_OVERHEAT"];
export const G950_STARTUP_CAS_MESSAGES = ["MSTR_WARN_TEST", "L_FIRE_DETECT_CB", "R_FIRE_DETECT_CB", "MSTR_CAUT_TEST", "AFT_BOOST1_PR", "AFT_BOOST2_PR", "AFT_FUEL_LOW", "DOORS_UNLOCKED", "DUCT_OVERHEAT",
  "FWD_BOOST1_PR", "FWD_BOOST2_PR", "FWD_FUEL_LOW", "HYD_PUMP_CB", "L_CHIP_DETECT", "L_GEN_FAIL", "L_GEN_OVHT", "L_OIL_PRESS", "L_PITOT_HT_FAIL", "L_PITOT_HT_OFF", "L_RFUEL_VLV_OPN", "L_TNK_PMP_FAIL",
  "LRG_MAG_VAR", "PNU_LOW_PRESS", "BETA_BCKP_DSRM", "R_GEN_FAIL", "R_GEN_OVHT", "R_CHIP_DETECT", "R_OIL_PRESS", "R_PITOT_HT_FAIL", "R_PITOT_HT_OFF", "R_RFUEL_VLV_OPN", "R_TNK_PMP_FAIL", "RESET_PROPS",
  "SLCT_MAG", "SLCT_NON_MAG", "CHECK_STANDBY", "L_FIRE_DETECT_FAIL", "MFD_FAN_FAIL", "PFD_1_FAN_FAIL", "PFD_2_FAN_FAIL", "PNU_LOW_PRESS_GND", "R_FIRE_DETECT_FAIL", "L_INTAKE_DFLCTR", "L_PROP_BETA",
  "L_STAB_DEICE_PR", "L_WING_TANK_PUMP", "R_INTAKE_DFLCTR", "R_PROP_BETA", "R_STAB_DEICE_PR", "R_WING_TANK_PUMP"];
export const LEGACY_ANNUNCIATOR_ID_MAP = { MSTR_CAUT_TEST: "MASTER_CAUTION", MASTER_CAUTION_TEST: "MASTER_CAUTION", "400_CYCLE_LIGHT": "AC_400_CYCLE", AC_400_CYCLE: "AC_400_CYCLE",
  AFT_BOOST1_PR: "BOOST_PUMP_1_AFT_PRESS", AFT_BOOST2_PR: "BOOST_PUMP_2_AFT_PRESS", AFT_FUEL_LOW: "AFT_FUEL_LOW_LEVEL", DOORS_UNLOCKED: "DOORS_UNLOCKED", DUCT_OVERHEAT: "DUCT_OVERHEAT",
  FWD_BOOST1_PR: "BOOST_PUMP_1_FWD_PRESS", FWD_BOOST2_PR: "BOOST_PUMP_2_FWD_PRESS", FWD_FUEL_LOW: "FWD_FUEL_LOW_LEVEL", L_GEN_FAIL: "L_GENERATOR", L_GEN_OVHT: "L_GENERATOR_OVERHEAT",
  L_OIL_PRESS: "L_ENGINE_OIL_PRESS", PNU_LOW_PRESS: "PNEUMATIC_LOW_PRESSURE", RESET_PROPS: "RESET_PROPS", R_GEN_FAIL: "R_GENERATOR", R_GEN_OVHT: "R_GENERATOR_OVERHEAT", R_OIL_PRESS: "R_ENGINE_OIL_PRESS" };
