import type { DimensionKey, FieldKey, MetricKey, ShopContentType } from "./report";

/** Aggregations a user can pick in the Values zone. */
export type Aggregation = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX";

/** A metric placed in the Values zone */
export interface ValueField {
  id: string;
  metric: MetricKey;
  aggregation: Aggregation;
}

/** A field sitting in the Rows or Columns zone. */
export interface PivotField {
  id: string;
  dimension: DimensionKey;
}

export type DropZoneId = "rows" | "columns" | "values";

export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "in"
  | "notIn"
  | "contains"
  | "isNull"
  | "isNotNull";

/** One row-level filter, applied before aggregation */
export type FilterValue = string | number | string[] | [number, number] | null;

export interface FilterCondition {
  id: string;
  field: FieldKey;
  operator: FilterOperator;
  value: FilterValue;
}

export type ChartType = "table" | "bar" | "line" | "pie";

/** Everything a saved view needs to reproduce a result. */
export interface AnalysisConfig {
  rows: PivotField[];
  columns: PivotField[];
  values: ValueField[];
  filters: FilterCondition[];
  chartType: ChartType;
}

export interface SavedView {
  id: string;
  name: string;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  config: AnalysisConfig;
}

/* ------------------------------------------------------------ pivot output */

/** A leaf cell: the aggregated number plus what it took to compute it. */
export interface PivotCell {
  value: number | null;
  /** Rows behind this cell, which is also what COUNT reports. */
  rowCount: number;
}

/** One rendered row of the pivot, already flattened for TanStack Table. */
export interface PivotRow {
  /** Dimension values in the order of `config.rows`. */
  rowKey: string[];
  /** Keyed by cellKey(columnKey, valueFieldId) from lib/pivotKeys.ts. */
  cells: Record<string, PivotCell>;
}

/** Header path for one column group, in the order of `config.columns`. */
export interface PivotColumnGroup {
  key: string;
  path: string[];
}

export interface PivotResult {
  rows: PivotRow[];
  columnGroups: PivotColumnGroup[];
  values: ValueField[];
  rowFields: PivotField[];
  columnFields: PivotField[];
  /** Grand total per value field, over every row that survived filtering. */
  grandTotals: Record<string, PivotCell>;
  /** Column subtotals, keyed the same way as PivotRow.cells. */
  columnTotals: Record<string, PivotCell>;
  /** Rows that passed the filters, the denominator behind every cell. */
  matchedRows: number;
}

/** Global filter state shared by both modes. */
export interface GlobalFilters {
  dateFrom: string;
  dateTo: string;
  advertiserId: string;
  storeId: string;
  search: string;
  creators: string[];
  products: string[];
  contentType: ShopContentType | "ALL";
}
