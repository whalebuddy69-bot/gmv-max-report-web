import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3 } from "lucide-react";
import type { CreativeSortKey, DimensionKey, MetricKey, ReportRow, SortDirection } from "@/types/report";
import { isCreativeSortKey } from "@/types/report";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/StateViews";
import { getMetric } from "@/lib/fieldCatalog";
import { rowMetricValue } from "@/lib/aggregate";
import { formatDimension, formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  deliveryStatusExportValue, deliveryStatusHeader, deliveryStatusTooltip,
  formatStatusCheckedAt, statusReportDateSchema,
} from "@/lib/creativeStatus";

type ReportDimensionKey = DimensionKey | "creativeDeliveryStatusCheckedAt" | "creativeDeliveryStatusStatDate";

const DIMENSION_COLUMNS: ReadonlyArray<{
  key: ReportDimensionKey;
  header: string;
  size: number;
  defaultHidden?: boolean;
}> = [
  // Hidden unless more than one store is in play
  { key: "storeName", header: "Store", size: 170, defaultHidden: true },
  { key: "itemGroupId", header: "Product ID", size: 150 },
  { key: "productName", header: "Product name", size: 240 },
  // The creative's own id. TikTok calls it a post; '-1' means the product card.
  { key: "itemId", header: "Post ID", size: 150 },
  { key: "title", header: "Creative", size: 220, defaultHidden: true },
  // Keep TikTok's display name and the separately verified username side by side.
  { key: "ttAccountName", header: "TikTok display name", size: 150 },
  { key: "ttAccountUsername", header: "TikTok username", size: 170 },
  { key: "shopContentType", header: "Creative type", size: 110 },
  { key: "campaignName", header: "Campaign name", size: 200, defaultHidden: true },
  { key: "authorizationType", header: "Authorization type", size: 150, defaultHidden: true },
  { key: "creativeDeliveryStatus", header: "Delivery status", size: 220, defaultHidden: true },
  { key: "creativeDeliveryStatusCheckedAt", header: "Status checked at (Asia/Bangkok)", size: 260, defaultHidden: true },
  { key: "creativeDeliveryStatusStatDate", header: "Status source report date", size: 190, defaultHidden: true },
];

function dimensionColumns(rows: readonly ReportRow[]) {
  return DIMENSION_COLUMNS.map((column) => column.key === "creativeDeliveryStatus"
    ? { ...column, header: deliveryStatusHeader(rows) } : column);
}

/** The tooltip keeps status freshness separate from both sales dates and Exploration. */
export function CreativeStatusCell({ row, field }: { row: ReportRow; field: ReportDimensionKey }) {
  const text = field === "creativeDeliveryStatusCheckedAt"
    ? formatStatusCheckedAt(row.creativeDeliveryStatusCheckedAt) ?? "(ยังไม่ทราบเวลาตรวจสอบ)"
    : field === "creativeDeliveryStatusStatDate"
      ? statusReportDateSchema.parse(row.creativeDeliveryStatusStatDate) ?? "(ยังไม่ทราบวันที่ต้นทาง)"
      : formatDimension(row.creativeDeliveryStatus);
  return <span className="block truncate text-xs" title={deliveryStatusTooltip(row)}>{text}</span>;
}

/** `costPerOrder`, `ctr`, `cvr`, `cpc`, `cpm` and `aov` have no column in the response */
const METRIC_COLUMNS: ReadonlyArray<{ key: MetricKey; size: number; defaultHidden?: boolean }> = [
  { key: "productImpressions", size: 130 },
  { key: "productClicks", size: 130 },
  // `ctr` is deliberately absent: at this grain each row is one creative, where clicks /
  // impressions is exactly what the service already sent as product_click_rate
  { key: "productClickRate", size: 150 },
  { key: "orders", size: 110 },
  { key: "grossRevenue", size: 140 },
  { key: "cost", size: 130 },
  { key: "roi", size: 90 },
  { key: "costPerOrder", size: 140 },
  { key: "cvr", size: 100, defaultHidden: true },
  { key: "aov", size: 170, defaultHidden: true },
  { key: "cpc", size: 110, defaultHidden: true },
  { key: "cpm", size: 110, defaultHidden: true },
];

function initialVisibility(): VisibilityState {
  const state: VisibilityState = {};
  for (const column of DIMENSION_COLUMNS) if (column.defaultHidden) state[column.key] = false;
  for (const column of METRIC_COLUMNS) if (column.defaultHidden) state[column.key] = false;
  return state;
}

export interface ReportTableProps {
  rows: readonly ReportRow[];
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  sortBy: CreativeSortKey;
  sortDir: SortDirection;
  onSortChange: (sortBy: CreativeSortKey, sortDir: SortDirection) => void;
  onSelectProduct?: (itemGroupId: string) => void;
  /** Reveals the Store column. Set when the current result spans several stores. */
  showStoreColumn?: boolean;
  /** Rendered in the toolbar, to the right of the column picker. */
  toolbarExtra?: React.ReactNode;
}

export function ReportTable({
  rows,
  isLoading,
  isFetching,
  error,
  onRetry,
  sortBy,
  sortDir,
  onSortChange,
  onSelectProduct,
  showStoreColumn = false,
  toolbarExtra,
}: ReportTableProps) {
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialVisibility);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const dimensions = useMemo(() => dimensionColumns(rows), [rows]);

  useEffect(() => {
    setColumnVisibility((current) => ({ ...current, storeName: showStoreColumn }));
  }, [showStoreColumn]);

  const columns = useMemo<ColumnDef<ReportRow>[]>(() => {
    const dimensionDefs: ColumnDef<ReportRow>[] = dimensions.map((column) => ({
      id: column.key,
      accessorKey: column.key,
      header: column.header,
      size: column.size,
      enableResizing: true,
      cell: ({ row }) => {
        const value = row.original[column.key];

        if (column.key === "creativeDeliveryStatus" || column.key === "creativeDeliveryStatusCheckedAt"
          || column.key === "creativeDeliveryStatusStatDate") {
          return <CreativeStatusCell row={row.original} field={column.key} />;
        }

        if (column.key === "itemGroupId" && onSelectProduct) {
          return (
            <button
              type="button"
              onClick={() => onSelectProduct(String(value))}
              className="tabular truncate text-left font-mono text-xs text-primary hover:underline"
              title="ดูผลงานของสินค้านี้"
            >
              {String(value)}
            </button>
          );
        }

        if (column.key === "storeName") {
          const text = typeof value === "string" && value ? value : row.original.storeId;
          return (
            <span className="block truncate font-medium" title={text}>
              {text}
            </span>
          );
        }

        if (column.key === "itemId") {
          // '-1' is the product card, not a video; showing the raw id reads as a bug.
          const label = value === "-1" ? "การ์ดสินค้า" : String(value);
          return <span className="tabular truncate font-mono text-xs">{label}</span>;
        }

        if (column.key === "shopContentType") {
          const label = value === "PRODUCT_CARD" ? "การ์ดสินค้า" : value === "VIDEO" ? "วิดีโอ" : "-";
          return <span className="whitespace-nowrap text-xs">{label}</span>;
        }

        const text = formatDimension(typeof value === "string" ? value : null);
        return (
          <span
            className={cn("block truncate", text === "(ไม่ทราบ)" && "text-muted-foreground italic")}
            title={text}
          >
            {text}
          </span>
        );
      },
    }));

    const metricDefs: ColumnDef<ReportRow>[] = METRIC_COLUMNS.map((column) => {
      const metric = getMetric(column.key);
      return {
        id: column.key,
        header: metric.label,
        size: column.size,
        enableResizing: true,
        meta: { numeric: true },
        cell: ({ row }) => (
          <span className="tabular block truncate text-right">
            {formatValue(rowMetricValue(row.original, column.key), metric.format)}
          </span>
        ),
      };
    });

    return [...dimensionDefs, ...metricDefs];
  }, [onSelectProduct, dimensions]);

  const table = useReactTable({
    data: rows as ReportRow[],
    columns,
    state: { columnVisibility, columnSizing },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    manualSorting: true,
    manualPagination: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  /** Cycles desc then asc */
  function toggleSort(columnId: string): void {
    if (!isCreativeSortKey(columnId)) return;
    if (sortBy !== columnId) return onSortChange(columnId, "desc");
    onSortChange(columnId, sortDir === "desc" ? "asc" : "desc");
  }

  const visibleLeafColumns = table.getVisibleLeafColumns();

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {isFetching && !isLoading ? "กำลังอัปเดต…" : `${rows.length.toLocaleString("th-TH")} แถวในหน้านี้`}
        </p>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 className="h-4 w-4" aria-hidden />
                คอลัมน์ ({visibleLeafColumns.length})
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-96 overflow-y-auto">
              <DropdownMenuLabel>Dimensions</DropdownMenuLabel>
              {dimensions.map((column) => (
                <ColumnToggle key={column.key} table={table} columnId={column.key} label={column.header} />
              ))}
              <DropdownMenuSeparator className="my-1 h-px bg-border" />
              <DropdownMenuLabel>Metrics</DropdownMenuLabel>
              {METRIC_COLUMNS.map((column) => (
                <ColumnToggle
                  key={column.key}
                  table={table}
                  columnId={column.key}
                  label={getMetric(column.key).label}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {toolbarExtra}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={10} columns={8} />
      ) : error ? (
        <ErrorState error={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="ไม่พบข้อมูลในช่วงที่เลือก"
          description="ลองขยายช่วงวันที่ หรือล้างตัวกรอง creator และสินค้าออก"
        />
      ) : (
        <div className={cn("scrollbar-thin overflow-x-auto", isFetching && "opacity-60 transition-opacity")}>
          <table className="w-full border-collapse text-sm" style={{ width: table.getTotalSize() }}>
            <colgroup>
              {visibleLeafColumns.map((column) => (
                <col key={column.id} style={{ width: column.getSize() }} />
              ))}
            </colgroup>

            <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const isNumeric = Boolean(
                      (header.column.columnDef.meta as { numeric?: boolean } | undefined)?.numeric,
                    );
                    const sortable = isCreativeSortKey(header.column.id);
                    const isSorted = sortable && sortBy === header.column.id;
                    const label = flexRender(header.column.columnDef.header, header.getContext());

                    return (
                      <th
                        key={header.id}
                        scope="col"
                        className="relative select-none border-b border-border px-2 py-2 text-xs font-medium text-muted-foreground"
                      >
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(header.column.id)}
                            className={cn(
                              "flex w-full items-center gap-1 hover:text-foreground",
                              isNumeric ? "justify-end" : "justify-start",
                              isSorted && "text-foreground",
                            )}
                          >
                            <span className="truncate">{label}</span>
                            {isSorted ? (
                              sortDir === "desc" ? (
                                <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />
                              ) : (
                                <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                              )
                            ) : (
                              <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-25" aria-hidden />
                            )}
                          </button>
                        ) : (
                          <span
                            className={cn("flex w-full truncate", isNumeric ? "justify-end" : "justify-start")}
                          >
                            {label}
                          </span>
                        )}

                        {header.column.getCanResize() ? (
                          <span
                            role="separator"
                            aria-orientation="vertical"
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            className={cn(
                              "absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none bg-border/0 hover:bg-primary/40",
                              header.column.getIsResizing() && "bg-primary",
                            )}
                          />
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60 hover:bg-accent/50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="max-w-0 px-2 py-1.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ColumnToggle({
  table,
  columnId,
  label,
}: {
  table: ReturnType<typeof useReactTable<ReportRow>>;
  columnId: string;
  label: string;
}) {
  const column = table.getColumn(columnId);
  if (!column) return null;

  return (
    <DropdownMenuCheckboxItem
      checked={column.getIsVisible()}
      onCheckedChange={(checked) => column.toggleVisibility(Boolean(checked))}
      onSelect={(event) => event.preventDefault()}
    >
      {label}
    </DropdownMenuCheckboxItem>
  );
}

/** Column set for the Excel export, mirroring what the table can show. */
export function reportExportColumns(rows: readonly ReportRow[] = []): ReadonlyArray<
  { kind: "dimension"; key: ReportDimensionKey; header: string; value?: (row: ReportRow) => string | null }
  | { kind: "metric"; key: MetricKey }
> {
  return [
    ...dimensionColumns(rows).map((c) => ({
      kind: "dimension" as const, key: c.key, header: c.header,
      value: c.key === "creativeDeliveryStatus" ? deliveryStatusExportValue
        : c.key === "creativeDeliveryStatusCheckedAt" ? (row: ReportRow) => formatStatusCheckedAt(row.creativeDeliveryStatusCheckedAt)
          : c.key === "creativeDeliveryStatusStatDate" ? (row: ReportRow) => statusReportDateSchema.parse(row.creativeDeliveryStatusStatDate)
            : undefined,
    })),
    ...METRIC_COLUMNS.map((c) => ({ kind: "metric" as const, key: c.key })),
  ];
}
