/*
  Dashboard "Training Signals" — port of DashboardViewModel.computeInsights.
*/
export function computeInsights(entries) {
  if (!entries || !entries.length) return [];
  const groups = new Map();
  entries.forEach(function (e) {
    const key = e.procedureName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  const insights = [];
  groups.forEach(function (attempts, procedureName) {
    const recent = attempts.slice().sort(function (a, b) { return b.timestampUtc - a.timestampUtc; }).slice(0, 5);
    const errors = recent.map(function (e) { return (e.wrongRoleCount || 0) + (e.wrongCalloutCount || 0) + (e.rushedCount || 0) + (e.toleranceUsedCount || 0); });
    const avgErrors = errors.length ? errors.reduce(function (s, v) { return s + v; }, 0) / errors.length : 0;
    const latestScore = recent[0] && recent[0].scorePercent != null ? recent[0].scorePercent : 0;
    const last = recent[recent.length - 1];
    const oldestRecentScore = last && last.scorePercent != null ? last.scorePercent : latestScore;
    const trendLabel = recent.length < 2 ? "New" : latestScore > oldestRecentScore ? "Improving" : latestScore < oldestRecentScore ? "Declining" : "Stable";
    const severity = (latestScore < 70 || avgErrors >= 4.0) ? "HIGH" : (latestScore < 85 || avgErrors >= 2.0) ? "MEDIUM" : "LOW";
    const statusLabel = severity === "HIGH" ? "High priority" : severity === "MEDIUM" ? "Needs review" : "Strong";
    insights.push({ procedureName: procedureName, statusLabel: statusLabel, trendLabel: trendLabel, severity: severity });
  });
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return insights.sort(function (a, b) { return rank[b.severity] - rank[a.severity]; }).slice(0, 3);
}
