import * as XLSX from "xlsx";
import type { ValueFormat } from "@/types/report";
import type { PivotResult } from "@/types/analysis";
import { fieldLabel, getMetric } from "./fieldCatalog";
import { formatDimension } from "./format";
import { cellKey } from "./pivotKeys";

/** What a column can be written as */
export type ExportFormat = ValueFormat | "date" | "datetime" | "time" | "duration";

/** Excel number-format codes, one per non-text ExportFormat. */
const NUM_FMT: Record<Exclude<ExportFormat, "text">, string> = {
  currency: '#,##0.00" ฿"',
  integer: "#,##0",
  // Rates arrive scaled 0-100, so a literal % suffix is right and 0.00% is not
  percent: '#,##0.00"%"',
  ratio: "#,##0.00",
  decimal: "#,##0.00",
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm:ss",
  time: "hh:mm:ss",
  // Brackets keep elapsed hours above 24 instead of wrapping like a clock.
  duration: "[h]:mm:ss",
};

const DATE_FORMATS = new Set<ExportFormat>(["date", "datetime", "time"]);

/** Days between Excel's epoch (1899-12-30) and the Unix epoch. */
const EXCEL_EPOCH_OFFSET = 25_569;
const MS_PER_DAY = 86_400_000;

/** A date string as an Excel serial number, or null when it does not parse */
function excelSerial(raw: string, format: ExportFormat): number | null {
  const text = raw.trim();

  if (format === "time") {
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (!match) return null;
    const [, hh, mm, ss] = match;
    return (Number(hh) * 3600 + Number(mm) * 60 + Number(ss ?? 0)) / 86_400;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;

  const days = Date.UTC(Number(y), Number(m) - 1, Number(d)) / MS_PER_DAY + EXCEL_EPOCH_OFFSET;
  if (!Number.isFinite(days)) return null;
  if (format === "date") return days;

  const seconds = Number(hh ?? 0) * 3600 + Number(mm ?? 0) * 60 + Number(ss ?? 0);
  return days + seconds / 86_400;
}

export interface ExportColumn<T> {
  header: string;
  format: ExportFormat;
  value: (row: T) => string | number | null;
  /** Character width; falls back to a measurement of the data. */
  width?: number;
  /** Trusted application formulas only (without =); value supplies the cached result. */
  formula?: (row: T, context: { rowNumber: number; firstDataRow: number; lastDataRow: number }) => string | null;
}

interface SheetOptions {
  sheetName: string;
  /** Rendered above the header as a single merged line. */
  subtitle?: string;
}

/** Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 characters. */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, "-").trim();
  return (cleaned || "Sheet1").slice(0, 31);
}

/** A leading =, +, - or @ makes Excel treat a cell as a formula */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function widthFor<T>(column: ExportColumn<T>, rows: readonly T[]): number {
  if (column.width) return column.width;

  let widest = column.header.length;
  // Sampling the head is enough to size a column and keeps a 100k-row export fast.
  for (const row of rows.slice(0, 200)) {
    const value = column.value(row);
    const length = value === null ? 1 : String(value).length;
    if (length > widest) widest = length;
  }
  return Math.min(Math.max(widest + 2, 8), 50);
}

/** Builds a worksheet with a frozen header, set widths and typed number cells. */
export function buildSheet<T>(
  rows: readonly T[],
  columns: readonly ExportColumn<T>[],
  options: SheetOptions,
): XLSX.WorkSheet {
  const headerOffset = options.subtitle ? 2 : 0;
  const matrix: (string | number | null)[][] = [];

  if (options.subtitle) {
    matrix.push([options.subtitle]);
    matrix.push([]);
  }
  matrix.push(columns.map((c) => c.header));

  for (const row of rows) {
    matrix.push(
      columns.map((column) => {
        const value = column.value(row);
        // Duration inputs are seconds; Excel stores elapsed time as fractions of a day.
        if (column.format === "duration") {
          return typeof value === "number" && Number.isFinite(value) && value >= 0
            ? value / 86_400
            : null;
        }
        if (typeof value !== "string") return value;

        /*
         * Dates become serial numbers here rather than at each call site, so a column declares
         * what it holds and this file owns how Excel is told
         */
        if (DATE_FORMATS.has(column.format)) {
          const serial = excelSerial(value, column.format);
          if (serial !== null) return serial;
        }
        return neutralizeFormula(value);
      }),
    );
  }

  const sheet = XLSX.utils.aoa_to_sheet(matrix, { cellDates: false });

  sheet["!cols"] = columns.map((column) => ({ wch: widthFor(column, rows) }));
  // Freeze everything above and including the header row.
  sheet["!freeze"] = { xSplit: "0", ySplit: String(headerOffset + 1) };
  sheet["!panes"] = [
    { pane: "bottomLeft", ySplit: headerOffset + 1, state: "frozen", topLeftCell: `A${headerOffset + 2}` },
  ];
  if (options.subtitle) {
    sheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(columns.length - 1, 0) } }];
  }

  const dataStartRow = headerOffset + 1;
  for (const [columnIndex, column] of columns.entries()) {
    if (column.format === "text" && !column.formula) continue;
    const numFmt = column.format === "text" ? undefined : NUM_FMT[column.format];

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: dataStartRow + rowIndex, c: columnIndex });
      let cell = sheet[address] as XLSX.CellObject | undefined;
      const formula = column.formula?.(rows[rowIndex]!, {
        rowNumber: dataStartRow + rowIndex + 1,
        firstDataRow: dataStartRow + 1,
        lastDataRow: dataStartRow + rows.length,
      });
      if (formula) {
        cell ??= { t: "s", v: "" };
        cell.f = formula;
        sheet[address] = cell;
      }
      if (cell && numFmt && (cell.t === "n" || formula)) cell.z = numFmt;
    }
  }

  // Bold the header via the cell style slot
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: headerOffset, c: columnIndex });
    const cell = sheet[address] as (XLSX.CellObject & { s?: unknown }) | undefined;
    if (cell) cell.s = { font: { bold: true } };
  }

  return sheet;
}

export interface WorkbookSheet<T> {
  name: string;
  rows: readonly T[];
  columns: readonly ExportColumn<T>[];
  subtitle?: string;
}

/** Writes one or more sheets and triggers the browser download. */
export function downloadWorkbook(sheets: readonly WorkbookSheet<never>[], fileName: string): void {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const worksheet = buildSheet(sheet.rows, sheet.columns, {
      sheetName: sheet.name,
      subtitle: sheet.subtitle,
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, safeSheetName(sheet.name));
  }

  XLSX.writeFile(workbook, fileName, { compression: true });
}

/** `gmv-max-report_2026-08-23.xlsx`, or a suffixed variant for a named view. */
export function makeFileName(prefix: string, suffix?: string): string {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  // \p{M} keeps Thai vowel and tone marks
  const slug = suffix ? `_${suffix.replace(/[^\p{L}\p{M}\p{N}_-]+/gu, "-").slice(0, 40)}` : "";
  return `${prefix}${slug}_${stamp}.xlsx`;
}

/* ------------------------------------------------------- pivot cross-tab */

/** One flattened pivot row, ready for `buildSheet`. */
type PivotExportRow = (string | number | null)[];

/** Turns a pivot into a cross-tab */
export function pivotToSheet(
  pivot: PivotResult,
  options: { sheetName: string; subtitle?: string; includeTotalsRow?: boolean },
): WorkbookSheet<never> {
  const columns: ExportColumn<PivotExportRow>[] = [];

  for (const [index, field] of pivot.rowFields.entries()) {
    columns.push({
      header: fieldLabel(field.dimension),
      format: "text",
      value: (row) => (row[index] as string | null) ?? null,
    });
  }

  let cursor = pivot.rowFields.length;
  const hasColumnFields = pivot.columnFields.length > 0;

  for (const group of pivot.columnGroups) {
    for (const valueField of pivot.values) {
      const metric = getMetric(valueField.metric);
      const metricLabel =
        valueField.aggregation === "SUM" ? metric.label : `${metric.label} (${valueField.aggregation})`;
      const header = hasColumnFields
        ? `${group.path.map(formatDimension).join(" · ")} · ${metricLabel}`
        : metricLabel;

      const columnIndex = cursor;
      cursor += 1;

      columns.push({
        header,
        format: valueField.aggregation === "COUNT" ? "integer" : metric.format,
        value: (row) => (row[columnIndex] as number | null) ?? null,
      });
    }
  }

  const rows: PivotExportRow[] = pivot.rows.map((pivotRow) => {
    const cells: PivotExportRow = pivotRow.rowKey.map((key) => formatDimension(key));
    for (const group of pivot.columnGroups) {
      for (const valueField of pivot.values) {
        cells.push(pivotRow.cells[cellKey(group.key, valueField.id)]?.value ?? null);
      }
    }
    return cells;
  });

  if (options.includeTotalsRow !== false && pivot.rows.length > 0) {
    const totals: PivotExportRow = pivot.rowFields.map((_, index) => (index === 0 ? "รวมทั้งหมด" : ""));
    for (const group of pivot.columnGroups) {
      for (const valueField of pivot.values) {
        totals.push(pivot.columnTotals[cellKey(group.key, valueField.id)]?.value ?? null);
      }
    }
    rows.push(totals);
  }

  return { name: options.sheetName, rows: rows as never[], columns: columns as never[], subtitle: options.subtitle };
}
