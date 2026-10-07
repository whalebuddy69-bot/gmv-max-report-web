import { useMemo, useState } from "react";
import type { CreativeSortKey, PromotionType, ReportRow, SortDirection } from "@/types/report";
import { GlobalFilterBar } from "@/components/shared/GlobalFilterBar";
import { ExportButton } from "@/components/shared/ExportButton";
import { Pagination } from "@/components/shared/Pagination";
import { WarningList } from "@/components/shared/StateViews";
import { SummaryCards, type ExtraCard } from "@/components/report/SummaryCards";
import { ReportTable, reportExportColumns } from "@/components/report/ReportTable";
import { LiveRoomTable } from "@/components/report/LiveRoomTable";
import { PromotionScopeSwitch } from "@/components/report/PromotionScopeSwitch";
import { ProductCardPanel } from "@/components/report/ProductCardPanel";
import {
  useCampaigns,
  useCreatives,
  useLiveRooms,
  useProducts,
  useStores,
  useSummary,
} from "@/hooks/useGmvReportData";
import { fetchAllCreatives, fetchAllDays, withProductNames, withStoreNames } from "@/api/analytics";
import { toRangeQuery, useFilterStore } from "@/store/filterStore";
import { getMetric } from "@/lib/fieldCatalog";
import { rowMetricValue } from "@/lib/aggregate";
import { makeFileName, type ExportColumn, type WorkbookSheet } from "@/lib/exportExcel";
import { liveRoomExportColumns } from "@/lib/liveRoomColumns";
import { dailyTotalsColumns } from "@/lib/dailyTotalsSheet";
import { formatDimension, formatDurationSeconds, toIsoDate } from "@/lib/format";
import { datesInRange, overallDailySheet } from "@/lib/overallDailySheet";
import { fetchOverallExport } from "@/api/overallExport";

const DEFAULT_PAGE_SIZE = 50;

/** Seatbelt on the export, not a page size */
const EXPORT_ROW_CAP = 50_000;

const SCOPE_LABEL: Record<PromotionType, string> = {
  PRODUCT: "Product",
  LIVE: "LIVE",
};

export function ReportDashboard() {
  const filters = useFilterStore();
  const range = toRangeQuery(filters);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortBy, setSortBy] = useState<CreativeSortKey>("cost");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);

  const creativeFilters = {
    ...range,
    accountName: filters.accountName ?? undefined,
    contentType: filters.contentType === "ALL" ? undefined : filters.contentType,
    sort: sortBy,
    direction: sortDir,
  };

  /* Live GMV Max promotes a live room, so TikTok returns nothing for it below campaign level */
  const isLive = filters.promotionType === "LIVE";

  const storesQuery = useStores();
  const summaryQuery = useSummary(range);
  const productsQuery = useProducts(range, { enabled: !isLive });
  const campaignsQuery = useCampaigns(range, { enabled: isLive });
  const liveRoomsQuery = useLiveRooms(range, { enabled: isLive });
  const creativesQuery = useCreatives(
    { ...creativeFilters, limit: pageSize, offset: (page - 1) * pageSize },
    { enabled: !isLive },
  );

  const rows = useMemo(
    () =>
      withStoreNames(
        withProductNames(creativesQuery.data?.rows ?? [], productsQuery.data ?? []),
        storesQuery.data ?? [],
      ),
    [creativesQuery.data, productsQuery.data, storesQuery.data],
  );

  /* Driven by what came back, not by what was picked */
  const storesInResult = useMemo(() => new Set(rows.map((row) => row.storeId)).size, [rows]);
  const showStoreColumn = storesInResult > 1;

  /* Campaigns are no longer a table of their own */
  const campaignRows = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);
  const creatorNames = useMemo(
    () =>
      new Map(
        campaignRows
          .filter((row) => row.ttAccountName !== null)
          .map((row) => [row.campaignId, row.ttAccountName as string]),
      ),
    [campaignRows],
  );

  const campaignNames = useMemo(
    () =>
      new Map(
        campaignRows
          .filter((row) => row.campaignName !== null)
          .map((row) => [row.campaignId, row.campaignName as string]),
      ),
    [campaignRows],
  );
  /** The campaign table carries store ids; the names live in the store list. */
  const storeNames = useMemo(
    () => new Map((storesQuery.data ?? []).map((store) => [store.storeId, store.storeName ?? store.storeId])),
    [storesQuery.data],
  );

  const roomRows = useMemo(() => liveRoomsQuery.data ?? [], [liveRoomsQuery.data]);

  /* Total time on air, summed from the rows already loaded */
  const liveDurationTotal = useMemo<ExtraCard[]>(() => {
    if (!isLive) return [];
    const withDuration = roomRows.filter((row) => row.durationSeconds !== null);
    const seconds = withDuration.reduce((total, row) => total + (row.durationSeconds ?? 0), 0);

    return [
      {
        key: "liveDuration",
        label: "Live duration",
        value: formatDurationSeconds(seconds),
        note:
          withDuration.length === roomRows.length
            ? `รวม ${roomRows.length.toLocaleString("th-TH")} ไลฟ์`
            : // Silently summing a subset would read as a total.
              `จาก ${withDuration.length.toLocaleString("th-TH")}/${roomRows.length.toLocaleString("th-TH")} ไลฟ์`,
      },
    ];
  }, [isLive, roomRows]);
  const roomStoreCount = useMemo(
    () => new Set(roomRows.map((row) => row.storeId)).size,
    [roomRows],
  );

  function handleSortChange(nextSortBy: CreativeSortKey, nextSortDir: SortDirection): void {
    setSortBy(nextSortBy);
    setSortDir(nextSortDir);
    setPage(1);
  }

  /** The "All" sheet: the summary cards, one row per day */
  async function buildDailyTotalsSheet(): Promise<WorkbookSheet<never>> {
    const days = await fetchAllDays(range);
    return {
      name: "All",
      rows: days as never[],
      columns: dailyTotalsColumns({ content: !isLive }) as never[],
      subtitle: `GMV Max ${SCOPE_LABEL[filters.promotionType]} · รายวัน · ${filters.dateFrom} ถึง ${filters.dateTo}`,
    };
  }

  async function buildOverallSheets(): Promise<WorkbookSheet<never>[]> {
    const data = await fetchOverallExport(range);
    const storeLabel = filters.storeIds.length
      ? filters.storeIds.map((id) => storeNames.get(id) ?? id).join(", ")
      : "ทุกร้าน";
    const sheet = overallDailySheet({
      ...data, storeLabel, today: toIsoDate(new Date()),
      creatorLabel: isLive && filters.identityId ? `LIVE Creator: ${filters.identityId}` : undefined,
    });
    return [{ ...sheet, rows: sheet.rows as never[], columns: sheet.columns as never[] }];
  }

  async function buildSheets(
    onProgress: (fetched: number, total: number) => void,
  ): Promise<WorkbookSheet<never>[]> {
    // Fetched here rather than held in a query: nobody should pay for an export they did not
    // ask for, and this is the only place that needs more than one page
    const all = await fetchAllCreatives(creativeFilters, {
      hardLimit: EXPORT_ROW_CAP,
      onProgress,
    });

    const exportRows: ReportRow[] = withStoreNames(
      withProductNames(all.rows, productsQuery.data ?? []),
      storesQuery.data ?? [],
    );

    const columns: ExportColumn<ReportRow>[] = reportExportColumns(exportRows).map((column) => {
      if (column.kind === "metric") {
        const metric = getMetric(column.key);
        return {
          header: metric.label,
          format: metric.format,
          value: (row: ReportRow) => rowMetricValue(row, column.key),
        };
      }
      return {
        header: column.header,
        format: "text" as const,
        value: (row: ReportRow) => {
          if (column.value) return column.value(row);
          const value = row[column.key];
          if (column.key === "itemId" && value === "-1") return "การ์ดสินค้า";
          return typeof value === "string" ? formatDimension(value) : null;
        },
      };
    });

    const subtitle = [
      `GMV Max Report · ${filters.dateFrom} ถึง ${filters.dateTo}`,
      filters.storeIds.length === 0 ? "ทุกร้าน" : `${filters.storeIds.length} ร้าน`,
      filters.accountName ? `Creator: ${filters.accountName}` : null,
      filters.contentType === "ALL" ? null : `ประเภท: ${filters.contentType}`,
      all.total > exportRows.length
        ? `แสดง ${exportRows.length.toLocaleString("th-TH")} แถวแรกจาก ${all.total.toLocaleString("th-TH")} แถว`
        : `${exportRows.length.toLocaleString("th-TH")} แถว`,
      "Delivery status = latest known only when check time/source date are available; independent of sales dates. Status checked at = our sync time (Asia/Bangkok), not TikTok status-change time",
    ]
      .filter(Boolean)
      .join(" · ");

    return [
      await buildDailyTotalsSheet(),
      { name: "Overall Performance", rows: exportRows as never[], columns: columns as never[], subtitle },
    ];
  }

  /** One sheet, the same rows and columns the table is showing */
  async function buildLiveRoomSheets(): Promise<WorkbookSheet<never>[]> {
    return [
      await buildDailyTotalsSheet(),
      {
        name: "Live rooms",
        rows: roomRows as never[],
        columns: liveRoomExportColumns({
          showStore: roomStoreCount > 1,
          storeNames,
          campaignNames,
          creatorNames,
        }) as never[],
        subtitle: [
          `Live GMV Max · รายไลฟ์ · ${filters.dateFrom} ถึง ${filters.dateTo}`,
          filters.storeIds.length === 0 ? "ทุกร้าน" : `${filters.storeIds.length} ร้าน`,
          `${roomRows.length.toLocaleString("th-TH")} ไลฟ์`,
          // Worth restating in the file, where the column header is all the reader has.
          "คอลัมน์ (Current shop) นับเฉพาะออเดอร์ของร้านในแถวนี้ ถึงแม้ไลฟ์จะขายสินค้าของร้านอื่นด้วย",
        ].join(" · "),
      },
    ];
  }

  /*
   * A service that predates promotionType ignores the parameter rather than rejecting it, and
   * answers every scope with Product rows
   */
  const scopeIgnored =
    isLive &&
    campaignRows.length > 0 &&
    campaignRows.every((row) => row.promotionType === "PRODUCT");

  const total = creativesQuery.data?.total ?? 0;
  const truncatedExport = total > EXPORT_ROW_CAP && !isLive;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GlobalFilterBar />

      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Overall · {SCOPE_LABEL[filters.promotionType]}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              ดาวน์โหลดรายวันตามร้าน ช่วงวันที่ และประเภทที่เลือก พร้อม Total ท้ายตาราง
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              ตัวเลขตามการ์ดสรุป ไม่ใช้ตัวกรองแคมเปญ/สินค้า/ชิ้นงาน · วันที่ไม่มีข้อมูลจะเว้นว่าง
            </p>
          </div>
          <ExportButton
            buildSheets={buildOverallSheets}
            fileName={`gmv-max-overall-${filters.promotionType.toLowerCase()}_${range.from}_to_${range.to}.xlsx`}
            rowCount={datesInRange(range.from, range.to).length}
            label="ดาวน์โหลด Overall รายวัน"
          />
        </div>
        <SummaryCards
          summary={summaryQuery.data}
          isLoading={summaryQuery.isLoading}
          content={!isLive}
          extra={liveDurationTotal}
        />

        <PromotionScopeSwitch value={filters.promotionType} onChange={filters.setPromotionType} />

        {scopeIgnored ? (
          <WarningList
            warnings={[
              "ขอข้อมูล Live GMV Max แต่ได้แคมเปญ Product กลับมาทั้งหมด - แปลว่า gmv-max-report " +
                "ที่ต่ออยู่ยังไม่รองรับการแยกประเภท ตัวเลขบนหน้านี้จึงเป็นของ Product ไม่ใช่ LIVE",
            ]}
          />
        ) : null}

        {truncatedExport ? (
          <WarningList
            warnings={[
              `ช่วงนี้มี ${total.toLocaleString("th-TH")} ชิ้นงาน เกินเพดานส่งออก ${EXPORT_ROW_CAP.toLocaleString("th-TH")} แถว - ไฟล์จะได้ไม่ครบ แคบช่วงวันที่หรือกรองเพิ่ม`,
            ]}
          />
        ) : null}

        {isLive ? (
          <section className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">ไลฟ์ทั้งหมด</h2>
                {/* <p className="text-xs text-muted-foreground"> หนึ่งแถวคือหนึ่งไลฟ์ */}
                {/* The one thing about this table that reads as a bug when it is not. */}
                {/* <p className="mt-1 text-xs text-muted-foreground"> ตัวกรองวันที่นับตาม <span className="font-medium">วันที่ลงรายงาน</span>{" "} ไม่ใช่วันที่เริ่มไลฟ์ */}
              </div>
            </div>

            <LiveRoomTable
              rows={roomRows}
              isLoading={liveRoomsQuery.isLoading}
              isFetching={liveRoomsQuery.isFetching}
              error={liveRoomsQuery.error}
              onRetry={() => void liveRoomsQuery.refetch()}
              showStoreColumn={roomStoreCount > 1}
              storeNames={storeNames}
              campaignNames={campaignNames}
              creatorNames={creatorNames}
              range={{ from: filters.dateFrom, to: filters.dateTo }}
              toolbarExtra={
                <ExportButton
                  buildSheets={buildLiveRoomSheets}
                  fileName={makeFileName("gmv-max-live-rooms")}
                  rowCount={roomRows.length}
                />
              }
            />
          </section>
        ) : (
          <section className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">
                  รายงานภาพรวม · {SCOPE_LABEL[filters.promotionType]}
                </h2>
                <p className="text-xs text-muted-foreground">
                  ระดับชิ้นงาน - หนึ่งแถวคือยอดรวมของชิ้นงานนั้นตลอดช่วงที่เลือก
                  {showStoreColumn ? ` · รวม ${storesInResult} ร้าน` : ""}
                </p>
              </div>
            </div>

            <ReportTable
              rows={rows}
              isLoading={creativesQuery.isLoading}
              isFetching={creativesQuery.isFetching}
              error={creativesQuery.error}
              onRetry={() => void creativesQuery.refetch()}
              sortBy={sortBy}
              sortDir={sortDir}
              onSortChange={handleSortChange}
              onSelectProduct={setSelectedProduct}
              showStoreColumn={showStoreColumn}
              toolbarExtra={
                <ExportButton
                  buildSheets={buildSheets}
                  fileName={makeFileName("gmv-max-report")}
                  rowCount={total}
                />
              }
            />

            {creativesQuery.data ? (
              <Pagination
                page={{ page, pageSize, totalRows: total }}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                disabled={creativesQuery.isFetching}
              />
            ) : null}
          </section>
        )}

        {selectedProduct && !isLive ? (
          <ProductCardPanel itemGroupId={selectedProduct} onClose={() => setSelectedProduct(null)} />
        ) : null}
      </div>
    </div>
  );
}
