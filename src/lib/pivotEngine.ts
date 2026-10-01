import type { ReportRow } from "@/types/report";
import type {
  AnalysisConfig,
  FilterCondition,
  PivotCell,
  PivotColumnGroup,
  PivotResult,
  PivotRow,
} from "@/types/analysis";
import { applyAggregation, rowMetricValue } from "./aggregate";
import { isMetricKey } from "./fieldCatalog";
import { TOTAL_COLUMN_KEY, cellKey, decodeGroupKey, encodeGroupKey } from "./pivotKeys";

/* ---------------------------------------------------------------- filters */

function compareNumbers(left: number, operator: FilterCondition["operator"], right: number): boolean {
  switch (operator) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      return true;
  }
}

/** Evaluates one condition against one row. */
export function matchesCondition(row: ReportRow, condition: FilterCondition): boolean {
  const { field, operator, value } = condition;

  if (operator === "isNull" || operator === "isNotNull") {
    const raw = isMetricKey(field) ? rowMetricValue(row, field) : row[field];
    const isNull = raw === null || raw === undefined || raw === "";
    return operator === "isNull" ? isNull : !isNull;
  }

  if (isMetricKey(field)) {
    const actual = rowMetricValue(row, field);
    // A null metric cannot satisfy a numeric comparison
    if (actual === null) return false;

    if (operator === "between") {
      if (!Array.isArray(value) || value.length !== 2) return true;
      const [min, max] = value as [number, number];
      return actual >= min && actual <= max;
    }
    if (typeof value !== "number") return true;
    return compareNumbers(actual, operator, value);
  }

  const actual = row[field];
  const text = actual === null || actual === undefined ? "" : String(actual);

  switch (operator) {
    case "in":
      return Array.isArray(value) && (value as string[]).includes(text);
    case "notIn":
      return !Array.isArray(value) || !(value as string[]).includes(text);
    case "contains":
      return typeof value === "string" && text.toLowerCase().includes(value.toLowerCase());
    case "eq":
      return text === String(value ?? "");
    case "neq":
      return text !== String(value ?? "");
    default:
      // Ordering comparisons on a text dimension fall back to lexicographic order, which is
      // what a user picking "gt" on a date string expects
      return typeof value === "string" ? compareText(text, operator, value) : true;
  }
}

function compareText(left: string, operator: FilterCondition["operator"], right: string): boolean {
  switch (operator) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      return true;
  }
}

/** All conditions must hold. An empty list passes everything. */
export function applyFilters(
  rows: readonly ReportRow[],
  filters: readonly FilterCondition[],
): ReportRow[] {
  if (filters.length === 0) return rows as ReportRow[];
  return rows.filter((row) => filters.every((condition) => matchesCondition(row, condition)));
}

/* ------------------------------------------------------------------ pivot */

const EMPTY_RESULT: Omit<PivotResult, "values" | "rowFields" | "columnFields"> = {
  rows: [],
  columnGroups: [],
  grandTotals: {},
  columnTotals: {},
  matchedRows: 0,
};

/**
 * Natural ordering for group keys: numeric where both sides parse as numbers, otherwise locale-
 * aware so Thai product names sort sensibly
 */
function compareKeys(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB) && a.trim() !== "" && b.trim() !== "") {
    return numA - numB;
  }
  return a.localeCompare(b, "th");
}

function compareGroupKeys(a: string, b: string): number {
  const pathA = decodeGroupKey(a);
  const pathB = decodeGroupKey(b);
  for (let i = 0; i < Math.max(pathA.length, pathB.length); i += 1) {
    const result = compareKeys(pathA[i] ?? "", pathB[i] ?? "");
    if (result !== 0) return result;
  }
  return 0;
}

export function computePivot(rows: readonly ReportRow[], config: AnalysisConfig): PivotResult {
  const { rows: rowFields, columns: columnFields, values, filters } = config;

  const filtered = applyFilters(rows, filters);

  if (values.length === 0 || filtered.length === 0) {
    return { ...EMPTY_RESULT, values, rowFields, columnFields, matchedRows: filtered.length };
  }

  // Bucket once; every value field then aggregates the same bucket.
  const buckets = new Map<string, Map<string, ReportRow[]>>();
  const rowKeyOrder = new Set<string>();
  const columnKeyOrder = new Set<string>();

  for (const row of filtered) {
    const rowKey = encodeGroupKey(rowFields.map((f) => row[f.dimension]));
    const columnKey =
      columnFields.length === 0
        ? TOTAL_COLUMN_KEY
        : encodeGroupKey(columnFields.map((f) => row[f.dimension]));

    rowKeyOrder.add(rowKey);
    columnKeyOrder.add(columnKey);

    let byColumn = buckets.get(rowKey);
    if (!byColumn) {
      byColumn = new Map<string, ReportRow[]>();
      buckets.set(rowKey, byColumn);
    }
    const bucket = byColumn.get(columnKey);
    if (bucket) bucket.push(row);
    else byColumn.set(columnKey, [row]);
  }

  const sortedRowKeys = [...rowKeyOrder].sort(compareGroupKeys);
  const sortedColumnKeys =
    columnFields.length === 0 ? [TOTAL_COLUMN_KEY] : [...columnKeyOrder].sort(compareGroupKeys);

  const columnGroups: PivotColumnGroup[] = sortedColumnKeys.map((key) => ({
    key,
    path: key === TOTAL_COLUMN_KEY ? [] : decodeGroupKey(key),
  }));

  const pivotRows: PivotRow[] = sortedRowKeys.map((rowKey) => {
    const byColumn = buckets.get(rowKey);
    const cells: Record<string, PivotCell> = {};

    for (const columnKey of sortedColumnKeys) {
      const bucket = byColumn?.get(columnKey) ?? [];
      for (const valueField of values) {
        cells[cellKey(columnKey, valueField.id)] = applyAggregation(
          bucket,
          valueField.metric,
          valueField.aggregation,
        );
      }
    }

    return { rowKey: rowFields.length === 0 ? ["รวมทั้งหมด"] : decodeGroupKey(rowKey), cells };
  });

  // Subtotals are recomputed from the rows in each column, not summed across cells: adding up
  // per-group ROIs would not give the column's ROI
  const columnTotals: Record<string, PivotCell> = {};
  for (const columnKey of sortedColumnKeys) {
    const columnRows: ReportRow[] = [];
    for (const byColumn of buckets.values()) {
      const bucket = byColumn.get(columnKey);
      if (bucket) columnRows.push(...bucket);
    }
    for (const valueField of values) {
      columnTotals[cellKey(columnKey, valueField.id)] = applyAggregation(
        columnRows,
        valueField.metric,
        valueField.aggregation,
      );
    }
  }

  const grandTotals: Record<string, PivotCell> = {};
  for (const valueField of values) {
    grandTotals[valueField.id] = applyAggregation(filtered, valueField.metric, valueField.aggregation);
  }

  return {
    rows: pivotRows,
    columnGroups,
    values,
    rowFields,
    columnFields,
    grandTotals,
    columnTotals,
    matchedRows: filtered.length,
  };
}

/** Flattens a pivot into the series a chart needs */
export interface ChartPoint {
  /** Row label, already joined across row fields. */
  name: string;
  /** One entry per column group, keyed by its joined label. */
  [series: string]: string | number | null;
}

export function pivotToChartData(
  pivot: PivotResult,
  valueFieldId: string,
): { data: ChartPoint[]; series: string[] } {
  const valueField = pivot.values.find((v) => v.id === valueFieldId);
  if (!valueField) return { data: [], series: [] };

  const hasColumns = pivot.columnFields.length > 0;
  const series = hasColumns
    ? pivot.columnGroups.map((group) => group.path.map((p) => p || "(ไม่ทราบ)").join(" · "))
    : ["ค่า"];

  const data: ChartPoint[] = pivot.rows.map((row) => {
    const point: ChartPoint = { name: row.rowKey.map((k) => k || "(ไม่ทราบ)").join(" · ") };
    for (const [index, group] of pivot.columnGroups.entries()) {
      const label = series[index] ?? group.key;
      point[label] = row.cells[cellKey(group.key, valueField.id)]?.value ?? null;
    }
    return point;
  });

  return { data, series };
}
