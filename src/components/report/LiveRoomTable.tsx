import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Radio } from "lucide-react";
import type { LiveRoomRow, ValueFormat } from "@/types/report";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/StateViews";
import { Pagination } from "@/components/shared/Pagination";
import { isNumericColumn, liveRoomColumns, type LiveRoomColumn } from "@/lib/liveRoomColumns";
import { EMPTY_VALUE, formatDimension, formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Matches the creative table, so switching tabs does not change how much you see. */
const DEFAULT_PAGE_SIZE = 50;

export interface LiveRoomTableProps {
  rows: LiveRoomRow[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  onRetry: () => void;
  showStoreColumn: boolean;
  storeNames: Map<string, string>;
  campaignNames: Map<string, string>;
  creatorNames: Map<string, string>;
  /** The selected window, used only to mark rows that began outside it */
  range: { from: string; to: string };
  toolbarExtra?: React.ReactNode;
}

export function LiveRoomTable({
  rows,
  isLoading,
  isFetching,
  error,
  onRetry,
  showStoreColumn,
  storeNames,
  campaignNames,
  creatorNames,
  range,
  toolbarExtra,
}: LiveRoomTableProps) {
  const [sortBy, setSortBy] = useState<keyof LiveRoomRow>("cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  /* Back to the first page whenever the row set is replaced */
  useEffect(() => {
    setPage(1);
  }, [rows]);

  const columns = useMemo(
    () => liveRoomColumns({ showStore: showStoreColumn, storeNames, campaignNames, creatorNames }),
    [showStoreColumn, storeNames, campaignNames, creatorNames],
  );

  const sorted = useMemo(() => {
    const direction = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = a[sortBy];
      const right = b[sortBy];

      // Nulls last whichever way the column points: a stream with no ROI yet is not the best or
      // the worst, it is not comparable
      if (left === null && right === null) return 0;
      if (left === null || left === undefined) return 1;
      if (right === null || right === undefined) return -1;

      if (typeof left === "string" || typeof right === "string") {
        return String(left).localeCompare(String(right), "th") * direction;
      }
      return (left - right) * direction;
    });
  }, [rows, sortBy, sortDir]);

  const visible = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  function toggleSort(key: keyof LiveRoomRow): void {
    // Re-sorting reorders every row, not just this page, so the page number no longer points at
    // what the reader was looking at
    setPage(1);
    if (key === sortBy) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    // Text reads best A→Z; a magnitude is interesting at the top.
    setSortDir(key === "liveName" || key === "startDate" ? "asc" : "desc");
  }

  if (isLoading) return <TableSkeleton />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    <>
      {toolbarExtra ? (
        <div className="flex items-center justify-end gap-2 border-b border-border px-4 py-2">
          {toolbarExtra}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="ไม่พบไลฟ์ในช่วงนี้"
          description="แคมเปญ Live อาจยังไม่เคยออกอากาศจริง หรือไลฟ์อยู่นอกช่วงวันที่ที่เลือก"
        />
      ) : (
        <div className={cn("scrollbar-thin overflow-x-auto", isFetching && "opacity-60")}>
          <table className="text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap px-3 py-2 font-medium",
                      column.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {column.sortKey ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.sortKey as keyof LiveRoomRow)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-foreground",
                          column.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {column.header}
                        <SortIcon active={sortBy === column.sortKey} direction={sortDir} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={`${row.storeId}:${row.campaignId}:${row.roomId}`}
                  className="border-b border-border/60 last:border-0 hover:bg-accent/40"
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "whitespace-nowrap px-3 py-2",
                        column.align === "right" && "tabular text-right",
                        (column.key === "liveName" ||
                          column.key === "campaignName" ||
                          column.key === "ttAccountName") &&
                          "max-w-[22rem] truncate",
                        column.key === "liveName" && "font-medium",
                        (column.key === "roomId" || column.key === "campaignId") &&
                          "tabular font-mono text-xs text-muted-foreground",
                      )}
                      title={
                        column.key === "liveName" ||
                        column.key === "campaignName" ||
                        column.key === "ttAccountName"
                          ? (String(column.value(row) ?? "") || undefined)
                          : undefined
                      }
                    >
                      <Cell column={column} row={row} range={range} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 ? (
        <Pagination
          page={{ page, pageSize, totalRows: sorted.length }}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          disabled={isFetching}
        />
      ) : null}
    </>
  );
}

/** YYYY-MM-DD strings compare correctly as text, so no parsing is needed here. */
function startedOutside(row: LiveRoomRow, range: { from: string; to: string }): boolean {
  const start = row.startDate;
  if (!start) return false;
  return start < range.from || start > range.to;
}

function Cell({
  column,
  row,
  range,
}: {
  column: LiveRoomColumn;
  row: LiveRoomRow;
  range: { from: string; to: string };
}) {
  // A stream still on air has numbers that are not final
  if (column.key === "liveStatus") {
    return row.liveStatus === "ONGOING" ? (
      <Badge className="whitespace-nowrap border-transparent bg-destructive/15 text-destructive">
        <Radio className="mr-1 h-3 w-3" aria-hidden />
        กำลังไลฟ์
      </Badge>
    ) : (
      <span className="text-xs text-muted-foreground">{formatDimension(row.liveStatus)}</span>
    );
  }

  const value = column.value(row);
  if (value === null) return <>{EMPTY_VALUE}</>;

  /*
   * A stream that began before the window still belongs in it: the filter is on the reporting
   * day, and TikTok attributes orders for days after a broadcast ends
   */
  if (column.key === "startDate" && startedOutside(row, range)) {
    return (
      <span
        className="text-warning underline decoration-dotted underline-offset-2"
        title={
          `ไลฟ์นี้เริ่ม ${String(value)} ซึ่งอยู่นอกช่วงที่เลือก แต่ยังมียอดที่ TikTok ` +
          `บันทึกเข้ามาในช่วงนี้ - ตัวกรองวันที่นับตามวันที่ลงรายงาน ไม่ใช่วันที่เริ่มไลฟ์ ` +
          `ตัวเลขในแถวนี้จึงเป็นเฉพาะส่วนที่ตกอยู่ในช่วงที่เลือก`
        }
      >
        {String(value)}
      </span>
    );
  }

  /*
   * The two are exclusive by construction: a numeric column's values are numbers, and a text or
   * date column's are strings
   */
  if (typeof value === "number" && isNumericColumn(column)) {
    return <>{formatValue(value, column.format as ValueFormat)}</>;
  }
  return <>{String(value)}</>;
}

function SortIcon({ active, direction }: { active: boolean; direction: "asc" | "desc" }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden />;
  return direction === "asc" ? (
    <ArrowUp className="h-3 w-3" aria-hidden />
  ) : (
    <ArrowDown className="h-3 w-3" aria-hidden />
  );
}
