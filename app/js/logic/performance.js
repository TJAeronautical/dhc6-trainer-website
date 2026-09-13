/*
  Performance calculator — port of domain/performance/PerformanceCalculator.kt
  and the state logic of feature-training/ui/performance/PerformanceCalcViewModel.kt.
  Data: core-res/assets/performance/dhc6_performance_tables.json (served in the
  `performance` content pack as `tables`).
*/

function lerp(start, end, fraction) { return start + (end - start) * Math.min(1, Math.max(0, fraction)); }

function bounds(values, target) {
  if (values.length <= 1) return { lowerIndex: 0, upperIndex: 0, fraction: 0 };
  const clamped = Math.min(values[values.length - 1], Math.max(values[0], target));
  let upper = values.findIndex(function (v) { return v >= clamped; });
  if (upper < 0) upper = values.length - 1;
  const lower = Math.max(0, upper - 1);
  const lowerValue = values[lower];
  const upperValue = values[upper];
  const fraction = upperValue === lowerValue ? 0 : (clamped - lowerValue) / (upperValue - lowerValue);
  return { lowerIndex: lower, upperIndex: upper, fraction: fraction };
}

function at(matrix, r, c, fallback) {
  const row = matrix[r];
  const v = row ? row[c] : undefined;
  return Number.isFinite(v) ? v : fallback;
}

export function interpolate2d(weightsLb, tempsC, values, weightLb, temperatureC) {
  if (!weightsLb.length || !tempsC.length || !values.length) return 0;
  const rowB = bounds(weightsLb, weightLb);
  const colB = bounds(tempsC, temperatureC);
  const q11 = at(values, rowB.lowerIndex, colB.lowerIndex, 0);
  const q12 = at(values, rowB.lowerIndex, colB.upperIndex, q11);
  const q21 = at(values, rowB.upperIndex, colB.lowerIndex, q11);
  const q22 = at(values, rowB.upperIndex, colB.upperIndex, q21);
  const r1 = lerp(q11, q12, colB.fraction);
  const r2 = lerp(q21, q22, colB.fraction);
  return lerp(r1, r2, rowB.fraction);
}

export function interpolate1d(xs, ys, x) {
  if (!xs.length || !ys.length) return 0;
  const b = bounds(xs, x);
  const y0 = Number.isFinite(ys[b.lowerIndex]) ? ys[b.lowerIndex] : 0;
  const y1 = Number.isFinite(ys[b.upperIndex]) ? ys[b.upperIndex] : y0;
  return lerp(y0, y1, b.fraction);
}

/* PerformanceCalcViewModel.loadTables — JSON → PerformanceTables */
export function parseTables(root) {
  const matrix = function (o) {
    return { tempsC: o.temps_c || [], weightsLb: o.weights_lb || [], waterRunFt: o.water_run_ft || [], distanceTo50Ft: o.dist_to_50ft || [] };
  };
  const rs = root.reference_speeds || {};
  const ps = root.performance_summary || {};
  return {
    version: root.version || "",
    sourceTakeoff: root.source_takeoff || "",
    sourceLanding: root.source_landing || "",
    sourceVref: root.source_vref || "",
    notes: root.notes || [],
    takeoff: matrix(root.takeoff || {}),
    landing: matrix(root.landing || {}),
    vref: { weightsLb: (root.vref || {}).weights_lb || [], rows: ((root.vref || {}).rows || []).map(function (r) { return { flaps: String(r.flaps), kias: r.kias || [] }; }) },
    referenceSpeeds: {
      v1Kias: rs.v1_kias | 0, v1Note: rs.v1_note || "",
      vyseKcas: rs.vyse_kcas | 0, vyseKias: rs.vyse_kias | 0, vyseNote: rs.vyse_note || "",
      vyKcas: rs.vy_kcas | 0, vyKias: rs.vy_kias | 0, vyNote: rs.vy_note || "",
      vxKcas: rs.vx_kcas | 0, vxKias: rs.vx_kias | 0, vxNote: rs.vx_note || "",
      vmcKcas: rs.vmc_kcas | 0, vmcKias: rs.vmc_kias | 0, vmcNote: rs.vmc_note || ""
    },
    performanceSummary: {
      oeiRateOfClimbFpm: ps.oei_rate_of_climb_fpm | 0, oeiRocNote: ps.oei_roc_note || "",
      oeiServiceCeilingFt: ps.oei_service_ceiling_ft | 0,
      bothEngRocFpm: ps.both_eng_roc_fpm | 0, bothEngRocNote: ps.both_eng_roc_note || "",
      serviceCeilingFt: ps.service_ceiling_ft | 0, maxAltFt: ps.max_alt_ft | 0
    }
  };
}

export const PerformanceCalculator = {
  takeoff: function (table, weightLb, temperatureC) {
    return {
      waterRunFt: interpolate2d(table.weightsLb, table.tempsC, table.waterRunFt, weightLb, temperatureC),
      distanceTo50Ft: interpolate2d(table.weightsLb, table.tempsC, table.distanceTo50Ft, weightLb, temperatureC),
      correctionSummary: "Authored seaplane flaps 20, PA 0 ft, calm-water table; no configuration correction applied"
    };
  },
  landing: function (table, weightLb, temperatureC) {
    return {
      waterRunFt: interpolate2d(table.weightsLb, table.tempsC, table.waterRunFt, weightLb, temperatureC),
      distanceTo50Ft: interpolate2d(table.weightsLb, table.tempsC, table.distanceTo50Ft, weightLb, temperatureC),
      correctionSummary: "Authored seaplane flaps 37.5, PA 0 ft, calm-water table; no configuration correction applied"
    };
  },
  vref: function (table, weightLb, flaps) {
    const row = table.rows.find(function (r) { return r.flaps === flaps; }) || table.rows[0];
    if (!row) return 0;
    return interpolate1d(table.weightsLb, row.kias, weightLb);
  },
  clampWeight: function (tables, weightLb) {
    const all = tables.takeoff.weightsLb.concat(tables.landing.weightsLb, tables.vref.weightsLb);
    if (!all.length) return weightLb;
    return Math.min(Math.max.apply(null, all), Math.max(Math.min.apply(null, all), weightLb));
  },
  clampTemperature: function (table, temperatureC) {
    if (!table.tempsC.length) return temperatureC;
    return Math.min(Math.max.apply(null, table.tempsC), Math.max(Math.min.apply(null, table.tempsC), temperatureC));
  }
};

/* PerformanceCalcViewModel.initialState + recalculate */
export function initialPerformanceState(tables) {
  const state = {
    isLoaded: true,
    sourceTakeoff: tables.sourceTakeoff,
    sourceLanding: tables.sourceLanding,
    sourceVref: tables.sourceVref,
    notes: tables.notes,
    referenceSpeeds: tables.referenceSpeeds,
    performanceSummary: tables.performanceSummary,
    availableFlaps: tables.vref.rows.map(function (r) { return r.flaps; }),
    weightMinLb: tables.takeoff.weightsLb.length ? Math.min.apply(null, tables.takeoff.weightsLb) : 9500,
    weightMaxLb: tables.takeoff.weightsLb.length ? Math.max.apply(null, tables.takeoff.weightsLb) : 12500,
    tempMinC: tables.takeoff.tempsC.length ? Math.min.apply(null, tables.takeoff.tempsC) : 28,
    tempMaxC: tables.takeoff.tempsC.length ? Math.max.apply(null, tables.takeoff.tempsC) : 32,
    weightLb: 12500,
    temperatureC: 30,
    takeoffFlaps: "20",
    landingFlaps: "37.5",
    selectedFlaps: "37.5"
  };
  return recalculate(state, tables);
}

export function recalculate(state, tables) {
  const vrefMin = tables.vref.weightsLb.length ? Math.min.apply(null, tables.vref.weightsLb) : state.weightLb;
  const vrefMax = tables.vref.weightsLb.length ? Math.max.apply(null, tables.vref.weightsLb) : state.weightLb;
  return Object.assign({}, state, {
    takeoffResult: PerformanceCalculator.takeoff(tables.takeoff, state.weightLb, state.temperatureC),
    landingResult: PerformanceCalculator.landing(tables.landing, state.weightLb, state.temperatureC),
    vrefKias: PerformanceCalculator.vref(tables.vref, Math.min(vrefMax, Math.max(vrefMin, state.weightLb)), state.selectedFlaps)
  });
}

export function setWeight(state, tables, value) { return recalculate(Object.assign({}, state, { weightLb: PerformanceCalculator.clampWeight(tables, value) }), tables); }
export function setTemperature(state, tables, value) { return recalculate(Object.assign({}, state, { temperatureC: PerformanceCalculator.clampTemperature(tables.takeoff, value) }), tables); }
export function setVrefFlaps(state, tables, flaps) { return recalculate(Object.assign({}, state, { selectedFlaps: flaps }), tables); }
