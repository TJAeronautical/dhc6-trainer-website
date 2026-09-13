/*
  Fuel planning and weight & balance — port of domain/calculators/Calculators.kt
  (FuelPlanCalculator, WeightBalanceCalculator) and the OccupantType seat model
  from feature-training/ui/calculators/CalculatorScreens.kt.
  Constants are the values authored in the Android app (POH PSM 1-63-1A 1.5.3,
  QRH HBFO-002 Section 11 / OM-B 11.1). Training use only.
*/

export const FuelPlanCalculator = {
  FWD_TANK_MAX_LB: 1235.0,
  AFT_TANK_MAX_LB: 1341.0,
  TOTAL_USABLE_LB: 2576.0,
  JET_A1_LB_PER_USG: 6.74,
  RESERVE_MIN_MINUTES: 45,
  FUEL_LOW_TRIGGER_LB: 300.0,
  CRUISE_BURN_LB_PER_HR_BOTH: 600.0,

  plan: function (opts) {
    const flightTimeMins = opts.flightTimeMins;
    const alternateMins = opts.alternateMins || 0;
    const contingencyPct = opts.contingencyPct == null ? 5 : opts.contingencyPct;
    const departFuelLb = opts.departFuelLb;
    const taxiFuelLb = opts.taxiFuelLb == null ? 50.0 : opts.taxiFuelLb;
    const burn = FuelPlanCalculator.CRUISE_BURN_LB_PER_HR_BOTH;
    const tripFuel = burn * (flightTimeMins / 60.0);
    const alternateFuel = alternateMins > 0 ? burn * (alternateMins / 60.0) : 0.0;
    const contingency = tripFuel * (contingencyPct / 100.0);
    const reserveFuel = burn * (FuelPlanCalculator.RESERVE_MIN_MINUTES / 60.0);
    const totalRequired = tripFuel + alternateFuel + contingency + reserveFuel + taxiFuelLb;
    const totalBoard = Math.min(departFuelLb, FuelPlanCalculator.TOTAL_USABLE_LB);
    const margin = totalBoard - totalRequired;
    const warnings = [];
    const notes = [];
    if (margin < 0) warnings.push("INSUFFICIENT FUEL: " + Math.round(-margin) + " lb short");
    if (reserveFuel > totalBoard * 0.5) warnings.push("Reserve exceeds 50% of total fuel — check planning");
    if (departFuelLb > FuelPlanCalculator.TOTAL_USABLE_LB) warnings.push("Fuel entered exceeds max usable (" + Math.round(FuelPlanCalculator.TOTAL_USABLE_LB) + " lb)");
    const landFuel = totalBoard - tripFuel - taxiFuelLb;
    if (landFuel < reserveFuel) warnings.push("Estimated landing fuel below 45-min reserve");
    if (landFuel < FuelPlanCalculator.FUEL_LOW_TRIGGER_LB) notes.push("Landing fuel near FUEL LOW LEVEL warning threshold (" + Math.round(FuelPlanCalculator.FUEL_LOW_TRIGGER_LB) + " lb)");
    const halfFuel = Math.min(departFuelLb / 2.0, FuelPlanCalculator.FWD_TANK_MAX_LB);
    const fwd = Math.min(halfFuel, FuelPlanCalculator.FWD_TANK_MAX_LB);
    const aft = Math.min(departFuelLb - fwd, FuelPlanCalculator.AFT_TANK_MAX_LB);
    notes.push("Burn rates: cruise 600 lb/hr (both), reserve basis 45 min");
    notes.push("Crossfeed: cannot transfer between tanks — plan for imbalance monitoring");
    return {
      tripFuelLb: tripFuel, reserveFuelLb: reserveFuel, alternateFuelLb: alternateFuel, contingencyLb: contingency,
      totalRequiredLb: totalRequired, totalBoardLb: totalBoard, marginLb: margin, isAdequate: margin >= 0,
      warnings: warnings, fwdTankLb: fwd, aftTankLb: aft, notes: notes, taxiFuelLb: taxiFuelLb
    };
  },
  lbToUsg: function (lb) { return lb / FuelPlanCalculator.JET_A1_LB_PER_USG; },
  usgToLb: function (usg) { return usg * FuelPlanCalculator.JET_A1_LB_PER_USG; }
};

export const WeightBalanceCalculator = {
  MTOW_LB: 12500.0,
  MLW_LB: 12300.0,
  MAC_IN: 78.0,
  LEMAC_IN: 188.24,
  FWD_LIMIT_ARM_IN: 207.74,
  AFT_LIMIT_ARM_IN: 213.20,

  calculate: function (items) {
    const W = WeightBalanceCalculator;
    const totalWeight = items.reduce(function (s, i) { return s + i.weightLb; }, 0);
    const totalMoment = items.reduce(function (s, i) { return s + i.weightLb * i.armIn; }, 0);
    const cg = totalWeight > 0 ? totalMoment / totalWeight : 0.0;
    const cgMac = totalWeight > 0 ? ((cg - W.LEMAC_IN) / W.MAC_IN) * 100.0 : 0.0;
    const cgOk = cg >= W.FWD_LIMIT_ARM_IN && cg <= W.AFT_LIMIT_ARM_IN;
    const weightOk = totalWeight <= W.MTOW_LB;
    const warnings = [];
    const notes = [];
    if (!weightOk) warnings.push("EXCEEDS MTOW by " + Math.round(totalWeight - W.MTOW_LB) + " lb");
    if (cg < W.FWD_LIMIT_ARM_IN) warnings.push("CG FORWARD of limit (" + W.FWD_LIMIT_ARM_IN + " in / 25% MAC)");
    if (cg > W.AFT_LIMIT_ARM_IN) warnings.push("CG AFT of limit (" + W.AFT_LIMIT_ARM_IN.toFixed(1) + " in / 32% MAC)");
    if (totalWeight > W.MLW_LB) notes.push("Exceeds MLW — fuel burn required before landing");
    notes.push("QRH OM-B 11.1 simplified CG limits: FWD 207.74 in (25% MAC), AFT 213.20 in (32% MAC)");
    notes.push("TRAINING USE ONLY — always use approved W&B forms for dispatch");
    return {
      totalWeightLb: totalWeight, totalMomentLbIn: totalMoment, cgArmIn: cg, cgMacPct: cgMac,
      isWithinCgLimits: cgOk, isWithinWeightLimits: weightOk, warnings: warnings, notes: notes
    };
  },

  /* Standard load items with default arms from POH Figure 6-5 */
  defaultLoadItems: function (o) {
    const v = Object.assign({ crewLb: 380.0, paxRow1Lb: 0, paxRow2Lb: 0, paxRow3Lb: 0, paxRow4Lb: 0, paxRow5Lb: 0, fwdBaggageLb: 0, aftBaggageLb: 0, fuelLb: 0, basicWeightLb: 8450.0 }, o || {});
    const items = [{ label: "Basic Weight (incl. oil + trapped fuel)", weightLb: v.basicWeightLb, armIn: 209.0 }];
    if (v.crewLb > 0) items.push({ label: "Flight Crew", weightLb: v.crewLb, armIn: 100.0 });
    if (v.paxRow1Lb > 0) items.push({ label: "Pax Row 1", weightLb: v.paxRow1Lb, armIn: 168.0 });
    if (v.paxRow2Lb > 0) items.push({ label: "Pax Row 2", weightLb: v.paxRow2Lb, armIn: 195.0 });
    if (v.paxRow3Lb > 0) items.push({ label: "Pax Row 3", weightLb: v.paxRow3Lb, armIn: 222.0 });
    if (v.paxRow4Lb > 0) items.push({ label: "Pax Row 4", weightLb: v.paxRow4Lb, armIn: 249.0 });
    if (v.paxRow5Lb > 0) items.push({ label: "Pax Row 5", weightLb: v.paxRow5Lb, armIn: 276.0 });
    if (v.fwdBaggageLb > 0) items.push({ label: "Fwd Baggage", weightLb: v.fwdBaggageLb, armIn: 38.0 });
    if (v.aftBaggageLb > 0) items.push({ label: "Aft Baggage", weightLb: v.aftBaggageLb, armIn: 344.0 });
    if (v.fuelLb > 0) items.push({ label: "Fuel (FWD+AFT)", weightLb: v.fuelLb, armIn: 210.0 });
    return items;
  }
};

/* CalculatorScreens.OccupantType — seat cycle Empty → M → F → C → FI */
export const OCCUPANT_TYPES = [
  { code: "—", key: "EMPTY", weightLb: 0, paxCount: 0 },
  { code: "M", key: "M", weightLb: 189, paxCount: 1 },
  { code: "F", key: "F", weightLb: 150, paxCount: 1 },
  { code: "C", key: "C", weightLb: 77, paxCount: 1 },
  { code: "FI", key: "FI", weightLb: 150, paxCount: 2 }
];
export function nextOccupant(index) { return (index + 1) % OCCUPANT_TYPES.length; }

/* CgEnvelopeChart geometry (POH Fig 2-2): FWD limit tapers 203.84" @11,600 lb → 207.74" @12,500 lb; AFT 216.32" */
export const CG_ENVELOPE = { wMin: 7500, mtow: 12500, armMin: 200, armMax: 220, fwdLow: 203.84, fwdLowWeight: 11600, fwdHigh: 207.74, aft: 216.32 };
