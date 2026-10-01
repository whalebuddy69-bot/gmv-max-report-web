import type { MetricKey, MetricTotals, ReportRow } from "@/types/report";
import type { Aggregation, PivotCell } from "@/types/analysis";
import { DERIVED_PARTS, METRICS, getMetric } from "./fieldCatalog";

const EMPTY_CELL: PivotCell = { value: null, rowCount: 0 };

/** Sums a raw column, returning null when no row carried a value at all. */
export function sumMetric(rows: readonly ReportRow[], key: MetricKey): number | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const raw = row[key as keyof ReportRow];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      total += raw;
      seen = true;
    }
  }
  return seen ? total : null;
}

function safeDivide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

/** A metric's value for a single row */
export function rowMetricValue(row: ReportRow, key: MetricKey): number | null {
  const stored = row[key as keyof ReportRow];
  if (typeof stored === "number" && Number.isFinite(stored)) return stored;
  if (stored !== undefined && stored !== null) return null;

  const parts = DERIVED_PARTS[key as keyof typeof DERIVED_PARTS];
  if (!parts) return null;

  const numerator = row[parts.numerator as keyof ReportRow];
  const denominator = row[parts.denominator as keyof ReportRow];
  if (typeof numerator !== "number" || typeof denominator !== "number") return null;

  const ratio = safeDivide(numerator, denominator);
  return ratio === null ? null : ratio * parts.scale;
}

/** The correct group value for a metric, ignoring any user-chosen aggregation */
export function aggregateMetric(rows: readonly ReportRow[], key: MetricKey): number | null {
  const descriptor = getMetric(key);

  switch (descriptor.aggregation) {
    case "sum":
      return sumMetric(rows, key);

    case "derived": {
      const parts = DERIVED_PARTS[key as keyof typeof DERIVED_PARTS];
      if (!parts) return null;
      const ratio = safeDivide(sumMetric(rows, parts.numerator), sumMetric(rows, parts.denominator));
      return ratio === null ? null : ratio * parts.scale;
    }

    case "weightedAvg": {
      // Weighted by the metric's denominator proxy, so a creative with 40k impressions does not
      // count the same as one with 400
      const weightKey = descriptor.weightBy;
      let weightedSum = 0;
      let weightTotal = 0;
      let unweightedSum = 0;
      let unweightedCount = 0;

      for (const row of rows) {
        const value = row[key as keyof ReportRow];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;

        unweightedSum += value;
        unweightedCount += 1;

        if (!weightKey) continue;
        const weight = row[weightKey as keyof ReportRow];
        if (typeof weight === "number" && Number.isFinite(weight) && weight > 0) {
          weightedSum += value * weight;
          weightTotal += weight;
        }
      }

      if (weightTotal > 0) return weightedSum / weightTotal;
      // Every candidate row had zero or missing weight
      return unweightedCount > 0 ? unweightedSum / unweightedCount : null;
    }
  }
}

/** Applies the aggregation the user picked in the Values zone. */
export function applyAggregation(
  rows: readonly ReportRow[],
  key: MetricKey,
  aggregation: Aggregation,
): PivotCell {
  if (rows.length === 0) return EMPTY_CELL;

  if (aggregation === "COUNT") {
    return { value: rows.length, rowCount: rows.length };
  }

  if (aggregation === "SUM") {
    return { value: aggregateMetric(rows, key), rowCount: rows.length };
  }

  const values: number[] = [];
  for (const row of rows) {
    const value = rowMetricValue(row, key);
    if (value !== null) values.push(value);
  }
  if (values.length === 0) return { value: null, rowCount: rows.length };

  switch (aggregation) {
    case "AVG": {
      const total = values.reduce((acc, v) => acc + v, 0);
      return { value: total / values.length, rowCount: rows.length };
    }
    case "MIN":
      return { value: Math.min(...values), rowCount: rows.length };
    case "MAX":
      return { value: Math.max(...values), rowCount: rows.length };
  }
}

/** Every metric rolled up over a row set, what the summary cards render. */
export function computeTotals(rows: readonly ReportRow[]): MetricTotals {
  const totals: MetricTotals = {};
  for (const metric of METRICS) {
    totals[metric.key] = aggregateMetric(rows, metric.key);
  }
  return totals;
}

/** True when a metric's rolled-up value is an estimate rather than exact, so the UI can mark it */
export function isApproximateAtGroup(key: MetricKey, rowCount: number): boolean {
  return rowCount > 1 && getMetric(key).approximate === true;
}
