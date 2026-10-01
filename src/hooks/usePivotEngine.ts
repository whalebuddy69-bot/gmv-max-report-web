import { useMemo } from "react";
import type { ReportRow } from "@/types/report";
import type { AnalysisConfig, PivotResult } from "@/types/analysis";
import { computePivot, pivotToChartData, type ChartPoint } from "@/lib/pivotEngine";

export interface PivotEngineResult {
  pivot: PivotResult;
  /** True when the config cannot produce a table yet. */
  isIncomplete: boolean;
  /** What the user still has to do, for the placeholder message. */
  incompleteReason: string | null;
}

export function usePivotEngine(
  rows: readonly ReportRow[] | undefined,
  config: AnalysisConfig,
): PivotEngineResult {
  const { rows: rowFields, columns: columnFields, values, filters } = config;

  const pivot = useMemo(
    () => computePivot(rows ?? [], { rows: rowFields, columns: columnFields, values, filters, chartType: config.chartType }),
    [rows, rowFields, columnFields, values, filters, config.chartType],
  );

  const incompleteReason = useMemo(() => {
    if (values.length === 0) return "ลาก metric อย่างน้อย 1 ตัวไปยังโซน Values";
    if (rowFields.length === 0 && columnFields.length === 0) {
      return "ลาก dimension ไปยังโซน Rows หรือ Columns เพื่อจัดกลุ่มข้อมูล";
    }
    return null;
  }, [values.length, rowFields.length, columnFields.length]);

  return { pivot, isIncomplete: incompleteReason !== null, incompleteReason };
}

/** Chart series for one value field. Separate hook so the table does not recompute. */
export function usePivotChartData(
  pivot: PivotResult,
  valueFieldId: string | null,
): { data: ChartPoint[]; series: string[] } {
  return useMemo(() => {
    if (!valueFieldId) return { data: [], series: [] };
    return pivotToChartData(pivot, valueFieldId);
  }, [pivot, valueFieldId]);
}
