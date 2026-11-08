import { useId, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { AutomationClient, AutomationPerformance, AutomationPoint } from "@/api/automation";
import { ApiError } from "@/api/client";
import { EmptyState, LoadingState } from "@/components/shared/StateViews";
import { Button } from "@/components/ui/button";
import { BANGKOK, performanceMatchesClient, summarizeCreatorPerformance, type AutomationMetric } from "@/lib/automation";
import { formatValue } from "@/lib/format";

const METRICS = {
  spendMinor: { label: "ยอดใช้จ่าย", format: "currency" },
  gmvMinor: { label: "GMV", format: "currency" },
  orders: { label: "ออเดอร์", format: "integer" },
  roi: { label: "ROI จริง", format: "ratio" },
  liveViews: { label: "LIVE Views", format: "integer" },
} as const;
const METRIC_KEYS = Object.keys(METRICS) as AutomationMetric[];
const readTime = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, hour: "2-digit", minute: "2-digit" });
type View = "hourly" | "daily";
type HistoricalProps = {
  client: AutomationClient;
  result: UseQueryResult<AutomationPerformance, Error>;
  payload: AutomationPerformance | null;
};

function printable(metric: AutomationMetric, value: number | null) {
  if (value === null) return "ไม่มีข้อมูล";
  const { format } = METRICS[metric];
  return formatValue(format === "currency" ? value / 100 : value, format);
}

/** A subtotal of supplied hour rows, not an account daily total. Never fill missing metrics with zero. */
export function summarizeReportedHours(series: readonly AutomationPoint[]) {
  let spendMinor: number | null = series.length > 0 ? 0 : null;
  for (const point of series) {
    if (spendMinor === null || point.spendMinor === null || !Number.isSafeInteger(spendMinor + point.spendMinor)) {
      spendMinor = null;
      break;
    }
    spendMinor += point.spendMinor;
  }
  return { spendMinor, ...summarizeCreatorPerformance(series) };
}

export function CreatorHistoricalPerformanceBody({
  client, payload, view, metric,
}: Pick<HistoricalProps, "client" | "payload"> & { view: View; metric: AutomationMetric }) {
  const exact = payload !== null && client.access === "verified" && performanceMatchesClient(payload, client) ? payload : null;
  if (!exact || exact.state !== "available" || !exact.observedAt || exact.series.length === 0) {
    return <EmptyState title="ยังไม่มีรายงานที่ยืนยันได้สำหรับแคมเปญนี้" description="ระบบไม่ใช้ตัวเลขจากบัญชี แคมเปญ หรือวันอื่น และไม่แทนข้อมูลที่ขาดด้วยศูนย์" />;
  }
  const latest = readTime.format(new Date(exact.observedAt));
  const caption = <p className="text-xs text-muted-foreground">
    {exact.series.length} ชั่วโมงที่ได้รับ · อ่านรายงาน {latest} น. (เวลาไทย)
  </p>;
  if (view === "daily") {
    const totals = summarizeReportedHours(exact.series);
    return <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">สรุปวันนี้ · เฉพาะชั่วโมงที่ได้รับ</h3>
        {caption}
      </div>
      <dl aria-label="สรุปจากชั่วโมงที่ได้รับ" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {METRIC_KEYS.map((key) => <div key={key} className="min-w-0 rounded-lg border border-border bg-background/50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{METRICS[key].label}</dt>
          <dd className="break-words text-sm font-semibold tabular">{printable(key, totals[key])}</dd>
        </div>)}
      </dl>
      <p className="text-xs text-muted-foreground">ไม่ใช่ยอดเต็มวัน · ROI จริงคำนวณจาก GMV ÷ ยอดใช้ของชั่วโมงชุดเดียวกัน · LIVE Views รวมตามรายชั่วโมง ไม่ใช่จำนวนผู้ชมไม่ซ้ำ</p>
    </div>;
  }

  return <div className="space-y-2">
    {caption}
    <table className="w-full text-sm" aria-label={`รายงานรายชั่วโมง: ${METRICS[metric].label}`}>
      <thead><tr className="border-b text-left">
        <th className="py-2 font-medium" scope="col">ชั่วโมงตามรายงาน TikTok</th>
        <th className="py-2 text-right font-medium" scope="col">{METRICS[metric].label}</th>
      </tr></thead>
      <tbody>
        {[...exact.series].sort((a, b) => a.hour.localeCompare(b.hour)).map((point) => (
          <tr key={point.hour} className="border-b last:border-0">
            <th className="py-2 font-normal tabular" scope="row">{point.hour}</th>
            <td className="py-2 text-right tabular">{printable(metric, point[metric])}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p className="text-xs text-muted-foreground">แสดงเฉพาะชั่วโมงที่ TikTok ส่งมา · ชั่วโมงที่หายไปไม่ใช่ยอดศูนย์</p>
  </div>;
}

export function CreatorHistoricalPerformance({ client, result, payload }: HistoricalProps) {
  const [view, setView] = useState<View>("hourly");
  const [metric, setMetric] = useState<AutomationMetric>("spendMinor");
  const headingId = useId();
  const denied = result.error instanceof ApiError && [401, 403, 404].includes(result.error.status ?? 0);
  const canRead = client.access === "verified" && client.campaign !== null && client.reportingDate !== null;
  return <section aria-labelledby={headingId} className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={headingId} className="text-base font-semibold">รายงานตามช่วงเวลา</h2>
        <p className="mt-1 break-words text-sm text-muted-foreground">{client.displayName}{client.reportingDate ? ` · ${client.reportingDate}` : ""}</p>
      </div>
      {canRead && !denied && <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void result.refetch()} disabled={result.isFetching}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> อัปเดตรายงาน
      </Button>}
    </div>
    <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
      ตอนนี้ดูได้เฉพาะข้อมูลวันนี้ของแคมเปญที่เปิดอยู่ ยังไม่รองรับการเลือกวันที่ย้อนหลัง
    </p>
    {!canRead ? (
      <EmptyState title={client.access === "verified" ? "ไม่พบแคมเปญที่เปิดอยู่" : "ยังอ่านรายงานของบัญชีนี้ไม่ได้"} />
    ) : denied ? (
      <EmptyState title="ยังเปิดรายงานของบัญชีนี้ไม่ได้" />
    ) : result.isError ? (
      <EmptyState title="อ่านรายงานล่าสุดไม่สำเร็จ" description="ลองกดอัปเดตรายงานอีกครั้ง" />
    ) : result.isPending ? (
      <LoadingState label="กำลังอ่านรายงานรายชั่วโมง…" />
    ) : <>
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="ช่วงรายงาน" className="inline-flex rounded-lg border border-border p-1">
          <Button type="button" size="sm" variant={view === "hourly" ? "secondary" : "ghost"} className="min-h-10" aria-pressed={view === "hourly"} onClick={() => setView("hourly")}>รายชั่วโมง</Button>
          <Button type="button" size="sm" variant={view === "daily" ? "secondary" : "ghost"} className="min-h-10" aria-pressed={view === "daily"} onClick={() => setView("daily")}>สรุปวันนี้</Button>
        </div>
        {view === "hourly" && <label className="inline-flex items-center gap-2 text-sm font-medium">
          ตัวชี้วัด
          <select value={metric} onChange={(event) => setMetric(event.target.value as AutomationMetric)}
            className="min-h-11 max-w-full rounded-md border border-input bg-background px-2 text-base sm:text-sm">
            {METRIC_KEYS.map((key) => <option key={key} value={key}>{METRICS[key].label}</option>)}
          </select>
        </label>}
      </div>
      <CreatorHistoricalPerformanceBody client={client} payload={payload} view={view} metric={metric} />
    </>}
  </section>;
}
