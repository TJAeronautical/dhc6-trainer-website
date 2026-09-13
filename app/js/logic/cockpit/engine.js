/*
  EngineSystemsModel — 1:1 port of feature-cockpit domain/system/EngineSystemsModel.kt
  plus EngineSimRunner + AutofeatherController (autofeather select/arm/trigger lamps).
  Power lever raw convention: 0 = full forward, 0.26 = flight idle gate, 1 = full reverse.
  Prop lever raw: 0 = max NP, 1 = feather side. Fuel lever raw: <= 0.5 = RUN.
*/

export const C = {
  FLIGHT_IDLE_GATE_01: 0.26,
  NG_IDLE_PERCENT: 52, NG_MAX_PERCENT: 102,
  NP_FLIGHT_MIN_PERCENT: 75, NP_MAX_PERCENT: 101.5, NP_WINDMILL_PERCENT: 8, NP_GROUND_IDLE_PERCENT: 52, NP_REVERSE_MAX_PERCENT: 91, NP_FLIGHT_LOW_GOV_PERCENT: 82,
  TORQUE_MAX_PERCENT: 53.3, TORQUE_GAUGE_GREEN_MAX_PSI: 50,
  FUEL_FLOW_GROUND_IDLE_PPH: 100, FUEL_FLOW_FLIGHT_IDLE_PPH: 300, FUEL_FLOW_MAX_PPH: 420,
  OIL_PRESSURE_MAX_PSI: 100, OIL_TEMP_MAX_C: 100, T5_MAX_C: 980,
  HYDRAULIC_AVAILABLE_NG: 60, HYDRAULIC_NOMINAL_PSI: 1600, HYDRAULIC_RISE_PSI_PER_SEC: 2500, HYDRAULIC_FALL_PSI_PER_SEC: 1800,
  INITIAL_FUEL_QTY_LB: 1000, AMBIENT_TEMPERATURE_C: 20,
  NG_RISE_RATE_PER_SEC: 24, NG_FALL_RATE_PER_SEC: 18, NP_RISE_RATE_PER_SEC: 55, NP_FALL_RATE_PER_SEC: 65, TORQUE_RISE_RATE_PER_SEC: 140, TORQUE_FALL_RATE_PER_SEC: 180,
  OIL_TEMP_RISE_RATE_C_PER_SEC: 7, OIL_TEMP_FALL_RATE_C_PER_SEC: 3, T5_RISE_RATE_C_PER_SEC: 55, T5_FALL_RATE_C_PER_SEC: 32,
  MIN_DT_SEC: 0.01, MAX_DT_SEC: 0.10, PROP_LOW_GOV_BREAK_01: 0.08,
  AUTOFEATHER_POWER_ARM_GATE_01: 0.12, AUTOFEATHER_TORQUE_ARM_PCT: 20, AUTOFEATHER_TORQUE_FIRE_PSI: 11, AUTOFEATHER_DELAY_SEC: 2.0,
  DEFAULT_VDC_VOLTS: 28
};

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function lerp(a, b, t) { return a + (b - a) * clamp01(t); }
function approach(current, target, rise, fall, dt) {
  const delta = target - current;
  if (Math.abs(delta) < 0.0001) return target;
  const maxStep = delta > 0 ? rise * dt : fall * dt;
  return current + clamp(delta, -maxStep, maxStep);
}
function shapedPower(x) { const c = clamp01(x); return c * c * 0.55 + c * 0.45; }
function normForward(v) { return v >= C.FLIGHT_IDLE_GATE_01 ? 0 : clamp01((C.FLIGHT_IDLE_GATE_01 - v) / C.FLIGHT_IDLE_GATE_01); }
function normReverse(v) { return v <= C.FLIGHT_IDLE_GATE_01 ? 0 : clamp01((v - C.FLIGHT_IDLE_GATE_01) / 0.74); }

function availableNpForNg(ng, fuelOn) {
  const t = clamp01(ng / C.NG_MAX_PERCENT);
  return fuelOn ? lerp(C.NP_WINDMILL_PERCENT, C.NP_MAX_PERCENT, t) : lerp(0, C.NP_WINDMILL_PERCENT, t);
}
function flightGovernedNpTarget(propNorm) {
  return propNorm <= C.PROP_LOW_GOV_BREAK_01 ? lerp(C.NP_FLIGHT_MIN_PERCENT, C.NP_FLIGHT_LOW_GOV_PERCENT, propNorm / C.PROP_LOW_GOV_BREAK_01)
    : lerp(C.NP_FLIGHT_LOW_GOV_PERCENT, C.NP_MAX_PERCENT, (propNorm - C.PROP_LOW_GOV_BREAK_01) / 0.92);
}

function computeNgTarget(power, prop, fuelOn) {
  if (!fuelOn) return 0;
  const demand = Math.max(normForward(power), normReverse(power) * 0.88);
  if (demand <= 0.0001) return C.NG_IDLE_PERCENT;
  const propForward = 1 - clamp01(prop);
  const penalty = (1 - propForward) * 0.35;
  return clamp(C.NG_IDLE_PERCENT + shapedPower(demand) * (C.NG_MAX_PERCENT - C.NG_IDLE_PERCENT) - penalty, C.NG_IDLE_PERCENT, C.NG_MAX_PERCENT);
}
function computeNpTarget(ng, power, prop, fuelOn) {
  if (ng < 1) return 0;
  const propForward = 1 - clamp01(prop);
  const cap = availableNpForNg(ng, fuelOn);
  if (!fuelOn) return clamp(cap, 0, C.NP_WINDMILL_PERCENT);
  const rev = normReverse(power);
  const raw = rev > 0.0001 ? lerp(C.NP_GROUND_IDLE_PERCENT, C.NP_REVERSE_MAX_PERCENT, rev) : flightGovernedNpTarget(propForward);
  return clamp(Math.min(raw, cap), 0, C.NP_MAX_PERCENT);
}
function computeTorqueTarget(ng, np, power, prop, fuelOn, ground) {
  if (!fuelOn || ng < 8) return 0;
  const fwd = normForward(power), rev = normReverse(power);
  if (rev > 0.0001) {
    const propForward = 1 - clamp01(prop);
    const base = lerp(3, 32, shapedPower(rev));
    const propDisc = 0.80 + 0.20 * propForward;
    const npDisc = 0.35 + 0.65 * clamp01(np / C.NP_REVERSE_MAX_PERCENT);
    return clamp(base * propDisc * npDisc, 0, C.TORQUE_MAX_PERCENT);
  }
  if (fwd <= 0.0001) return 0;
  const gas = clamp01((ng - C.NG_IDLE_PERCENT) / (C.NG_MAX_PERCENT - C.NG_IDLE_PERCENT));
  const shaped = shapedPower(Math.max(gas, fwd));
  const effNp = clamp(np, C.NP_FLIGHT_LOW_GOV_PERCENT, C.NP_MAX_PERCENT);
  const inv = clamp(C.NP_MAX_PERCENT / effNp, 1, 1.36);
  const rpmLoad = lerp(1, inv, 0.72);
  const back = clamp01((C.NP_MAX_PERCENT - effNp) / (C.NP_MAX_PERCENT - C.NP_FLIGHT_LOW_GOV_PERCENT));
  const gov = lerp(1.0, 1.10, back);
  const groundPenalty = ground ? 0.95 : 1;
  return clamp(shaped * 50 * rpmLoad * gov * groundPenalty, 0, C.TORQUE_MAX_PERCENT);
}
function computeFuelFlow(ng, tq, np, fuelOn, ground) {
  if (!fuelOn || ng < 5) return 0;
  const ngN = clamp01((ng - 52) / 50), tqN = clamp01(tq / 53.3), npN = clamp01(np / 101.5);
  const idle = ground ? 100 : 300;
  return clamp(idle + ngN * 40 + tqN * 70 + npN * 10, 0, 420);
}
function computeOilPressure(ng, oilTemp, fuelOn) {
  if (!fuelOn || ng < 12) return 0;
  const ngN = clamp01((ng - 15) / (102 - 15));
  const hot = clamp((oilTemp - 95) / 70, 0, 0.25);
  return clamp(32 + ngN * 60 - hot * 26, 0, 100);
}
function computeOilTempTarget(ng, tq, fuelOn) {
  if (!fuelOn) return 20;
  const ngN = clamp01((ng - 52) / 50), tqN = clamp01(tq / 53.3);
  return clamp(46 + ngN * 18 + tqN * 36, 20, 100);
}
function computeT5Target(ng, tq, np, power, fuelOn, ground) {
  if (!fuelOn) return 20;
  const ngN = clamp01((ng - 52) / 50), tqN = clamp01(tq / 53.3), npN = clamp01(np / 101.5);
  const fwd = normForward(power), rev = normReverse(power);
  const transient = ground && rev > 0 ? 20 * (1 - rev) : 0;
  const base = 330 + ngN * 110 + tqN * 290 + (1 - npN) * 55;
  const inFlightGoverned = !ground && fwd > 0 && rev <= 0;
  const back = clamp01((101.5 - np) / (101.5 - 82));
  const heat = inFlightGoverned ? back * tqN * 55 : 0;
  return clamp(base + heat - transient, 20, 980);
}

function sideState() { return { ng: 0, np: 0, torque: 0, t5: C.AMBIENT_TEMPERATURE_C, oilTemp: C.AMBIENT_TEMPERATURE_C, lowTorqueTimer: 0, autofeatherFired: false }; }

function updateSide(s, power, prop, fuelOn, ground, afArmed, dt) {
  const targetNg = computeNgTarget(power, prop, fuelOn);
  const ng = approach(s.ng, targetNg, targetNg > s.ng ? C.NG_RISE_RATE_PER_SEC : C.NG_FALL_RATE_PER_SEC, C.NG_FALL_RATE_PER_SEC, dt);
  const np = approach(s.np, computeNpTarget(ng, power, prop, fuelOn), C.NP_RISE_RATE_PER_SEC, C.NP_FALL_RATE_PER_SEC, dt);
  const torque = approach(s.torque, computeTorqueTarget(ng, np, power, prop, fuelOn, ground), C.TORQUE_RISE_RATE_PER_SEC, C.TORQUE_FALL_RATE_PER_SEC, dt);
  const oilTemp = approach(s.oilTemp, computeOilTempTarget(ng, torque, fuelOn), C.OIL_TEMP_RISE_RATE_C_PER_SEC, C.OIL_TEMP_FALL_RATE_C_PER_SEC, dt);
  const t5 = approach(s.t5, computeT5Target(ng, torque, np, power, fuelOn, ground), C.T5_RISE_RATE_C_PER_SEC, C.T5_FALL_RATE_C_PER_SEC, dt);
  const torquePsi = torque / 53.3 * 50;
  const lowTorque = afArmed && torquePsi < C.AUTOFEATHER_TORQUE_FIRE_PSI;
  const timer = lowTorque ? s.lowTorqueTimer + dt : 0;
  const fire = timer >= C.AUTOFEATHER_DELAY_SEC && !s.autofeatherFired;
  return {
    ng: ng, np: fire ? approach(s.np, 0, C.NP_RISE_RATE_PER_SEC, C.NP_FALL_RATE_PER_SEC, dt) : np,
    torque: fire ? 0 : torque, t5: t5, oilTemp: oilTemp, lowTorqueTimer: timer, autofeatherFired: s.autofeatherFired || fire
  };
}

export function createEngineModel() {
  const state = { left: sideState(), right: sideState(), fuelL: C.INITIAL_FUEL_QTY_LB, fuelR: C.INITIAL_FUEL_QTY_LB, hydraulic: 0 };
  function sideOut(s, power, prop, fuelOn, ground) {
    const ff = computeFuelFlow(s.ng, s.torque, s.np, fuelOn, ground);
    const reverse = normReverse(power), forward = normForward(power);
    const blade = (!fuelOn && s.np < 5) ? 87 : reverse > 0.001 ? lerp(17, -15, reverse) : lerp(17, 87, 1 - forward);
    return { ngPercent: s.ng, npPercent: s.np, torquePercent: s.torque, t5Celsius: s.t5, oilTemperatureC: s.oilTemp, fuelFlowPph: ff,
      oilPressurePsi: computeOilPressure(s.ng, s.oilTemp, fuelOn), groundOperation: ground, bladeAngleDeg: blade, autofeatherFired: s.autofeatherFired };
  }
  return {
    state: state,
    reset: function () { state.left = sideState(); state.right = sideState(); state.fuelL = C.INITIAL_FUEL_QTY_LB; state.fuelR = C.INITIAL_FUEL_QTY_LB; state.hydraulic = 0; },
    tick: function (powerL, powerR, propL, propR, fuelLeverL, fuelLeverR, wow, dtSec, autofeatherSystemOn) {
      const dt = clamp(dtSec, C.MIN_DT_SEC, C.MAX_DT_SEC);
      const pL = clamp01(powerL), pR = clamp01(powerR), prL = clamp01(propL), prR = clamp01(propR);
      const fuelOnL = fuelLeverL <= 0.5, fuelOnR = fuelLeverR <= 0.5;
      const groundL = Boolean(wow) || pL > C.FLIGHT_IDLE_GATE_01;
      const groundR = Boolean(wow) || pR > C.FLIGHT_IDLE_GATE_01;
      const afOn = Boolean(autofeatherSystemOn);
      const afL = afOn && pL < C.AUTOFEATHER_POWER_ARM_GATE_01 && pR < C.AUTOFEATHER_POWER_ARM_GATE_01 && state.left.torque >= C.AUTOFEATHER_TORQUE_ARM_PCT && !state.left.autofeatherFired;
      const afR = afOn && pL < C.AUTOFEATHER_POWER_ARM_GATE_01 && pR < C.AUTOFEATHER_POWER_ARM_GATE_01 && state.right.torque >= C.AUTOFEATHER_TORQUE_ARM_PCT && !state.right.autofeatherFired;
      state.left = updateSide(state.left, pL, prL, fuelOnL, groundL, afL, dt);
      state.right = updateSide(state.right, pR, prR, fuelOnR, groundR, afR, dt);
      const left = sideOut(state.left, pL, prL, fuelOnL, groundL);
      const right = sideOut(state.right, pR, prR, fuelOnR, groundR);
      state.fuelL = Math.max(0, state.fuelL - left.fuelFlowPph * dt / 3600);
      state.fuelR = Math.max(0, state.fuelR - right.fuelFlowPph * dt / 3600);
      const hydTarget = (state.left.ng >= C.HYDRAULIC_AVAILABLE_NG || state.right.ng >= C.HYDRAULIC_AVAILABLE_NG) ? C.HYDRAULIC_NOMINAL_PSI : 0;
      state.hydraulic = approach(state.hydraulic, hydTarget, C.HYDRAULIC_RISE_PSI_PER_SEC, C.HYDRAULIC_FALL_PSI_PER_SEC, dt);
      return { left: left, right: right, fuelQuantityLeftLb: state.fuelL, fuelQuantityRightLb: state.fuelR, hydraulicPressurePsi: state.hydraulic };
    }
  };
}

/* Deterministic warm-up used by the frozen snapshot renderer (180 ticks at 30 Hz). */
export function warmUp(levers, wow, ticks) {
  const model = createEngineModel();
  let out = null;
  const n = ticks || 180;
  for (let i = 0; i < n; i += 1) out = model.tick(levers.powerL, levers.powerR, levers.propL, levers.propR, levers.fuelL, levers.fuelR, wow, 1 / 30, false);
  return out;
}

/* ---------------------------------------------- AutofeatherController + EngineSimRunner */
const REVERSE_MAX_FORWARD_01 = 0.18;

export function createAutofeather() {
  const s = { selected: false, triggeredL: false, triggeredR: false, lastTorqueL: 0, lastTorqueR: 0 };
  const armTorqueThreshold = 60, featherTriggerTorque = 20, ngMin = 60, torqueMin = 60, powerMin = 0.65, propMin = 0.80;
  function armedEffective(wow, strict) {
    if (!s.selected) return false;
    if (wow) return false;
    if (!strict) return true;
    if (strict.betaL || strict.betaR || strict.reverseL || strict.reverseR) return false;
    if (strict.ngL < ngMin || strict.ngR < ngMin) return false;
    if (strict.torqueL < torqueMin || strict.torqueR < torqueMin) return false;
    if (strict.powerL < powerMin || strict.powerR < powerMin) return false;
    if (strict.propL != null && strict.propR != null && (strict.propL < propMin || strict.propR < propMin)) return false;
    return true;
  }
  return {
    setSelected: function (v) { s.selected = Boolean(v); if (!s.selected) { s.triggeredL = false; s.triggeredR = false; } },
    isSelected: function () { return s.selected; },
    isTriggered: function (side) { return side === "L" ? s.triggeredL : side === "R" ? s.triggeredR : false; },
    updateStrict: function (torqueL, torqueR, wow, strict) {
      const armed = armedEffective(wow, strict);
      if (!armed) { s.lastTorqueL = torqueL; s.lastTorqueR = torqueR; return armed; }
      if (s.lastTorqueL > armTorqueThreshold && torqueL < featherTriggerTorque) s.triggeredL = true;
      if (s.lastTorqueR > armTorqueThreshold && torqueR < featherTriggerTorque) s.triggeredR = true;
      s.lastTorqueL = torqueL; s.lastTorqueR = torqueR;
      return armed;
    }
  };
}

export function createSimRunner(autofeather) {
  const af = autofeather || createAutofeather();
  return {
    autofeather: af,
    tick: function (powerL, powerR, propL, propR, fuelLeverL, fuelLeverR, engineOutput, autofeatherSelected, wow) {
      const pL = clamp01(powerL), pR = clamp01(powerR), prL = clamp01(propL), prR = clamp01(propR);
      const fuelOnL = fuelLeverL <= 0.5, fuelOnR = fuelLeverR <= 0.5;
      const left = engineOutput.left, right = engineOutput.right;
      const reverseL = fuelOnL && left.groundOperation && pL <= REVERSE_MAX_FORWARD_01;
      const reverseR = fuelOnR && right.groundOperation && pR <= REVERSE_MAX_FORWARD_01;
      const betaL = fuelOnL && left.groundOperation && !reverseL && pL < C.FLIGHT_IDLE_GATE_01 && pL > REVERSE_MAX_FORWARD_01;
      const betaR = fuelOnR && right.groundOperation && !reverseR && pR < C.FLIGHT_IDLE_GATE_01 && pR > REVERSE_MAX_FORWARD_01;
      af.setSelected(autofeatherSelected);
      af.updateStrict(left.torquePercent, right.torquePercent, wow, { ngL: left.ngPercent, ngR: right.ngPercent, torqueL: left.torquePercent, torqueR: right.torquePercent,
        powerL: pL, powerR: pR, propL: prL, propR: prR, betaL: betaL, betaR: betaR, reverseL: reverseL, reverseR: reverseR });
      let armLamp = false;
      if (autofeatherSelected && !wow && !betaL && !betaR && !reverseL && !reverseR &&
        left.ngPercent >= 60 && right.ngPercent >= 60 && left.torquePercent >= 60 && right.torquePercent >= 60 && pL >= 0.65 && pR >= 0.65 && prL >= 0.80 && prR >= 0.80) armLamp = true;
      return { ngL: left.ngPercent, ngR: right.ngPercent, npL: left.npPercent, npR: right.npPercent, torqueL: left.torquePercent, torqueR: right.torquePercent,
        selectLamp: Boolean(autofeatherSelected), armLamp: armLamp, triggeredL: af.isTriggered("L"), triggeredR: af.isTriggered("R") };
    }
  };
}
