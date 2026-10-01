import { useMemo } from "react";
import { X } from "lucide-react";
import type { CreativeSortKey, MetricKey, ProductRow } from "@/types/report";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/StateViews";
import { ExportButton } from "@/components/shared/ExportButton";
import { useCreatives, useProducts } from "@/hooks/useGmvReportData";
import { toRangeQuery, useFilterStore } from "@/store/filterStore";
import { getMetric } from "@/lib/fieldCatalog";
import { rowMetricValue } from "@/lib/aggregate";
import { makeFileName, type ExportColumn, type WorkbookSheet } from "@/lib/exportExcel";
import { formatDimension, formatValue } from "@/lib/format";

const TOTAL_METRICS: readonly MetricKey[] = ["cost", "orders", "grossRevenue", "roi", "costPerOrder"];
const CREATIVE_METRICS: readonly MetricKey[] = [
  "productImpressions",
  "productClicks",
  "productClickRate",
  "orders",
  "grossRevenue",
  "cost",
  "roi",
];

/** Creatives per product; well past what any single product has in practice. */
const CREATIVE_LIMIT = 500;
const SORT_BY: CreativeSortKey = "cost";

export interface ProductCardPanelProps {
  itemGroupId: string;
  onClose: () => void;
}

export function ProductCardPanel({ itemGroupId, onClose }: ProductCardPanelProps) {
  const filters = useFilterStore();
  const range = toRangeQuery(filters);
  const scoped = { ...range, itemGroupId };

  const productsQuery = useProducts(scoped);
  const creativesQuery = useCreatives({
    ...scoped,
    sort: SORT_BY,
    direction: "desc",
    limit: CREATIVE_LIMIT,
    offset: 0,
  });

  const product: ProductRow | undefined = useMemo(
    () => productsQuery.data?.find((p) => p.itemGroupId === itemGroupId),
    [productsQuery.data, itemGroupId],
  );

  const creatives = creativesQuery.data?.rows ?? [];
  const isLoading = productsQuery.isLoading || creativesQuery.isLoading;
  const error = productsQuery.error ?? creativesQuery.error;

  function buildSheets(): WorkbookSheet<never>[] {
    const columns: ExportColumn<(typeof creatives)[number]>[] = [
      { header: "Post ID", format: "text", value: (r) => (r.itemId === "-1" ? "การ์ดสินค้า" : r.itemId) },
      { header: "Creative", format: "text", value: (r) => r.title },
      { header: "TikTok display name", format: "text", value: (r) => r.ttAccountName },
      { header: "Campaign name", format: "text", value: (r) => r.campaignName },
      ...CREATIVE_METRICS.map((key) => {
        const metric = getMetric(key);
        return {
          header: metric.label,
          format: metric.format,
          value: (r: (typeof creatives)[number]) => rowMetricValue(r, key),
        };
      }),
    ];

    return [
      {
        name: "Product Card",
        rows: creatives as never[],
        columns: columns as never[],
        subtitle: `${product?.productName ?? itemGroupId} · ${filters.dateFrom} ถึง ${filters.dateTo}`,
      },
    ];
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            {product?.productName ?? "ผลงานรายสินค้า"}
          </h2>
          <p className="tabular truncate font-mono text-xs text-muted-foreground">{itemGroupId}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ExportButton
            buildSheets={buildSheets}
            fileName={makeFileName("gmv-max-product-card", itemGroupId)}
            rowCount={creatives.length}
            label="ส่งออก"
          />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="ปิด">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </header>

      {isLoading ? (
        <LoadingState label="กำลังโหลดผลงานของสินค้านี้…" />
      ) : error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            void productsQuery.refetch();
            void creativesQuery.refetch();
          }}
        />
      ) : !product && creatives.length === 0 ? (
        <EmptyState
          title="สินค้านี้ไม่มีข้อมูลในช่วงที่เลือก"
          description="ลองขยายช่วงวันที่ออกไป"
        />
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {TOTAL_METRICS.map((key) => {
              const metric = getMetric(key);
              return (
                <Badge key={key} variant="secondary" className="gap-1.5 rounded-md px-2.5 py-1">
                  <span className="text-muted-foreground">{metric.label}</span>
                  <span className="tabular font-semibold">
                    {formatValue(
                      product ? ((product[key as keyof ProductRow] as number | null) ?? null) : null,
                      metric.format,
                    )}
                  </span>
                </Badge>
              );
            })}
            {product?.campaigns ? (
              <Badge variant="outline" className="gap-1.5 rounded-md px-2.5 py-1">
                <span className="text-muted-foreground">Campaigns</span>
                <span className="tabular font-semibold">{product.campaigns}</span>
              </Badge>
            ) : null}
          </div>

          {creatives.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              สินค้านี้มียอดใช้จ่าย แต่ไม่มีชิ้นงานที่ตรงกับตัวกรองปัจจุบัน
            </p>
          ) : (
            <div className="scrollbar-thin max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">Post ID</th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">TikTok display name</th>
                    {CREATIVE_METRICS.map((key) => (
                      <th key={key} scope="col" className="px-2 py-1.5 text-right font-medium">
                        {getMetric(key).label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {creatives.map((row) => (
                    <tr
                      key={`${row.campaignId}-${row.itemId}`}
                      className="border-b border-border/60 hover:bg-accent/50"
                    >
                      <td className="tabular whitespace-nowrap px-2 py-1.5 font-mono text-xs">
                        {row.itemId === "-1" ? "การ์ดสินค้า" : row.itemId}
                      </td>
                      <td className="max-w-40 truncate px-2 py-1.5" title={row.ttAccountName ?? ""}>
                        {formatDimension(row.ttAccountName)}
                      </td>
                      {CREATIVE_METRICS.map((key) => (
                        <td key={key} className="tabular px-2 py-1.5 text-right">
                          {formatValue(rowMetricValue(row, key), getMetric(key).format)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
