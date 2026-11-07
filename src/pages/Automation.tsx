import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowDown, ArrowUp, CirclePause, CirclePlay, Clock3, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchAutomationOverview, fetchAutomationPerformance, type AutomationClient, type AutomationCampaign } from "@/api/automation";
import { ApiError } from "@/api/client";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BANGKOK, formatHour, isFreshAutomationClient, isStalePerformance, performanceMatchesClient, toHourlyChart, type AutomationMetric } from "@/lib/automation";
import { formatCompact, formatValue } from "@/lib/format";
import { useAuthStore } from "@/store/authStore";

const number = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 });
const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, dateStyle: "medium", timeStyle: "short" });
const formatTime = (date: string | null) => date === null ? "ยังไม่มีข้อมูล" : time.format(new Date(date));
const formatMoney = (minor: number | null) => minor === null ? "ยังไม่มีข้อมูล" : formatValue(minor / 100, "currency");
const SECTION = "min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5";
const METRICS = {
  spendMinor: { label: "ยอดใช้จ่าย", format: "currency", unit: "บาท" },
  gmvMinor: { label: "GMV", format: "currency", unit: "บาท" },
  roi: { label: "ROI", format: "ratio", unit: "เท่า" },
  orders: { label: "ออเดอร์", format: "integer", unit: "ออเดอร์" },
  liveViews: { label: "LIVE Views", format: "integer", unit: "ครั้ง" },
} as const;

function stopPolling(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);
}

function Stats({ clients, now }: { clients: AutomationClient[]; now: number }) {
  const verified = clients.filter((client) => isFreshAutomationClient(client, now));
  const enabled = verified.filter((client) => client.campaign !== null);
  const stats = [
    { label: "บัญชีที่ตั้งค่าแล้ว", value: clients.length, hint: "เฉพาะ Creator ที่เชื่อมกับระบบ" },
    { label: "ยืนยันการเข้าถึงแล้ว", value: verified.length, hint: "อ่านข้อมูลได้และยังเป็นข้อมูลล่าสุด" },
    { label: "แคมเปญเปิดอยู่", value: enabled.length, hint: "สถานะเปิด ไม่ใช่หลักฐานว่ากำลังไลฟ์" },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {stats.map(({ label, value, hint }) => (
        <div key={label} className={SECTION}>
          <dt className="text-sm font-medium">{label}</dt>
          <dd className="tabular mt-1 text-3xl font-semibold tracking-tight">{number.format(value)}</dd>
          <dd className="mt-1 text-sm text-muted-foreground">{hint}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AccessStatus({ client, now }: { client: AutomationClient; now: number }) {
  if (client.access !== "verified") return <Badge variant="outline">ยังยืนยันการเข้าถึงไม่ได้</Badge>;
  if (!isFreshAutomationClient(client, now)) return <Badge variant="warning">ข้อมูลเก่า</Badge>;
  return <Badge variant="success">อ่านข้อมูลได้</Badge>;
}

function AccessInventory({ clients, now }: { clients: AutomationClient[]; now: number }) {
  return (
    <section className={SECTION} aria-labelledby="automation-access">
      <div className="mb-4 flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h2 id="automation-access" className="text-base font-semibold">Access · บัญชีที่ระบบเข้าถึง</h2>
          <p className="mt-1 text-sm text-muted-foreground">รายการนี้ไม่ใช่บัญชีทั้งหมดของ Agency และไม่แสดงบัญชีที่ยังไม่ได้ตั้งค่า</p>
        </div>
      </div>
      {clients.length === 0 ? (
        <p className="rounded-md bg-muted px-3 py-3 text-sm">ยังไม่มีบัญชี Creator ที่ตั้งค่าให้ดูใน Automation</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {clients.map((client) => (
            <li key={client.clientId} className="grid min-w-0 gap-2 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] md:items-center md:gap-4">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold">{client.displayName}</p>
                <p className="text-xs text-muted-foreground">Creator · LIVE GMV Max</p>
              </div>
              <dl className="grid min-w-0 gap-1 text-xs">
                <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">Ad Account ID</dt><dd className="font-mono break-all">{client.advertiserId}</dd></div>
                <div className="flex flex-wrap gap-x-2"><dt className="text-muted-foreground">TikTok Account ID</dt><dd className="font-mono break-all">{client.tiktokAccountId}</dd></div>
              </dl>
              <div className="flex flex-wrap items-center gap-2 md:items-end md:flex-col">
                <AccessStatus client={client} now={now} />
                <span className="text-xs text-muted-foreground">{formatTime(client.observedAt)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ACTIONS = [
  { label: "เปิด", icon: CirclePlay },
  { label: "ปิด/พัก", icon: CirclePause },
  { label: "เพิ่มงบ", icon: ArrowUp },
  { label: "ลดงบ", icon: ArrowDown },
  { label: "Auto", icon: Activity },
] as const;

export function ReadOnlyActions() {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground" id="automation-write-disabled">
        <LockKeyhole className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        รุ่นนี้อ่านข้อมูลเท่านั้น ปุ่มสั่งงานยังไม่เชื่อม TikTok
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ACTIONS.map(({ label, icon: Icon }) => (
          <Button key={label} type="button" variant="outline" size="sm" disabled aria-describedby="automation-write-disabled">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function BudgetMeter({ campaign }: { campaign: AutomationCampaign }) {
  const percent = campaign.spendMinor === null ? null : (campaign.spendMinor / campaign.dailyBudgetMinor) * 100;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <p className="font-medium">ใช้งบวันนี้</p>
        <p className="tabular text-muted-foreground">
          {percent === null ? "ยังยืนยันยอดใช้ไม่ได้" : `${number.format(percent)}% ของงบแคมเปญ`}
        </p>
      </div>
      {percent !== null && (
        <div
          className="relative mt-2 h-2.5 rounded-full bg-muted"
          role="meter"
          aria-label="สัดส่วนงบที่ใช้วันนี้"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, percent)}
          aria-valuetext={`${number.format(percent)}% ของงบแคมเปญ เกณฑ์แจ้งเตือน 80%`}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} />
          <span className="absolute -top-0.5 h-3.5 w-0.5 bg-foreground" style={{ left: "80%" }} aria-hidden />
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        กฎจำลอง: ใช้ถึง 80% → เสนอเพิ่ม 20% หลังตรวจเพดาน · ยังไม่สั่งปรับงบอัตโนมัติ
      </p>
    </div>
  );
}

function CampaignCards({ clients, selectedId, onSelect }: {
  clients: AutomationClient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className={SECTION} aria-labelledby="automation-enabled-campaigns">
      <h2 id="automation-enabled-campaigns" className="text-base font-semibold">แคมเปญที่เปิดอยู่</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        แสดงแคมเปญที่ TikTok รายงานว่าเปิดใช้งาน ไม่ได้ยืนยันว่ากำลังส่งโฆษณาหรือไลฟ์อยู่
      </p>
      {clients.length === 0 ? (
        <p className="mt-4 rounded-md bg-muted px-3 py-3 text-sm">ยังไม่มีแคมเปญเปิดอยู่ที่ยืนยันได้จากข้อมูลล่าสุด</p>
      ) : (
        <ul className="mt-4 grid gap-3 xl:grid-cols-2">
          {clients.map((client) => {
            const campaign = client.campaign;
            if (!campaign) return null;
            return (
              <li key={client.clientId} className="min-w-0 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">{campaign.campaignName}</p>
                    <p className="break-all text-xs text-muted-foreground">{client.displayName} · {campaign.campaignId}</p>
                  </div>
                  <Badge variant="success">เปิดใช้งาน</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                  <div><dt className="text-xs text-muted-foreground">งบปัจจุบัน</dt><dd className="tabular font-medium">{formatMoney(campaign.dailyBudgetMinor)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">ใช้แล้วโดยประมาณ</dt><dd className="tabular font-medium">{formatMoney(campaign.spendMinor)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">ROI Target</dt><dd className="tabular font-medium">{campaign.targetRoi === null ? "ยังไม่มีข้อมูล" : `${number.format(campaign.targetRoi)} เท่า`}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">เพดานรวมต่อวัน</dt><dd className="text-sm">ยังไม่เชื่อมกับ LINE</dd></div>
                </dl>
                <BudgetMeter campaign={campaign} />
                {clients.length > 1 && (
                  <Button type="button" variant="outline" size="sm" className="mt-3" aria-pressed={selectedId === client.clientId} onClick={() => onSelect(client.clientId)}>
                    ดู Performance
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ReadOnlyActions />
    </section>
  );
}

function PerformancePanel({ client, userId }: { client: AutomationClient; userId: number }) {
  const [metric, setMetric] = useState<AutomationMetric>("spendMinor");
  const result = useQuery({
    queryKey: ["automation", "performance", userId, client.clientId, client.campaign?.campaignId, client.reportingDate],
    queryFn: ({ signal }) => fetchAutomationPerformance(signal),
    enabled: client.campaign !== null,
    gcTime: 0,
    retry: false,
    staleTime: 120_000,
    refetchInterval: (query) => stopPolling(query.state.error) ? false : 180_000,
  });
  const payload = result.isSuccess && performanceMatchesClient(result.data, client) ? result.data : null;
  const stale = payload !== null && isStalePerformance(payload);
  const rows = payload?.state === "available" && !stale ? toHourlyChart(payload.series, metric) : [];
  const metricInfo = METRICS[metric];
  const hasValues = rows.some(({ value }) => value !== null);
  return (
    <section className={SECTION} aria-labelledby="automation-performance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="automation-performance" className="text-base font-semibold">Performance รายชั่วโมง</h2>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {client.displayName} · {client.reportingDate} · รายงาน Creator จาก TikTok
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => void result.refetch()} disabled={result.isFetching || stopPolling(result.error)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> อัปเดตกราฟ
        </Button>
      </div>
      <label className="mt-4 inline-flex flex-wrap items-center gap-2 text-sm font-medium">
        ตัวชี้วัด
        <select
          value={metric}
          onChange={(event) => setMetric(event.target.value as AutomationMetric)}
          className="min-h-10 max-w-full rounded-md border border-input bg-background px-2 text-base sm:text-sm"
        >
          {Object.entries(METRICS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
        </select>
      </label>
      {result.isPending ? <LoadingState label="กำลังอ่านรายงานรายชั่วโมง…" /> : result.isError ? (
        stopPolling(result.error) ? <EmptyState title="ยังเปิดกราฟสำหรับบัญชีนี้ไม่ได้" description="ไม่มีสิทธิ์หรือยังไม่ได้เปิดส่วนรายงาน Automation" /> :
          <ErrorState error={result.error} onRetry={() => void result.refetch()} />
      ) : !payload ? (
        <EmptyState title="ยังไม่มีรายงานที่ตรงกับแคมเปญนี้" description="ระบบจะไม่แสดงตัวเลขของแคมเปญเดิมหรือวันอื่น" />
      ) : payload.state === "no-active-campaign" ? (
        <EmptyState title="ไม่พบแคมเปญที่เปิดอยู่ในรายงานล่าสุด" />
      ) : payload.state === "unavailable" ? (
        <EmptyState title="TikTok ยังไม่ส่งรายงานที่ยืนยันได้" description="ไม่ได้หมายความว่า Performance เป็นศูนย์" />
      ) : stale ? (
        <EmptyState title="ข้อมูลรายชั่วโมงเก่าแล้ว" description="กดอัปเดตเพื่ออ่านรายงานล่าสุด ระบบไม่แสดงข้อมูลเก่าเป็นสถานะปัจจุบัน" />
      ) : !hasValues ? (
        <EmptyState title={`ยังไม่มีค่า ${metricInfo.label} รายชั่วโมงที่ยืนยันได้`} description="ช่องที่ไม่มีข้อมูลจะไม่แสดงเป็นศูนย์" />
      ) : (
        <>
          <p className="mt-3 text-xs text-muted-foreground">หน่วย: {metricInfo.unit} · ชั่วโมงตามป้ายเวลาที่ TikTok ส่งมา</p>
          <div className="mt-2 h-[240px] min-w-0 sm:h-[300px]" role="img" aria-label={`กราฟ ${metricInfo.label} รายชั่วโมง`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 12, right: 14, bottom: 8, left: 2 }}>
                <CartesianGrid vertical={false} stroke="var(--color-border)" />
                <XAxis type="number" dataKey="minute" domain={[0, 1439]} ticks={[0, 360, 720, 1080, 1380]} tickFormatter={formatHour} minTickGap={18} tick={{ fontSize: 11 }} />
                <YAxis width={64} tickFormatter={(value: number) => formatCompact(value, metricInfo.format)} tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(value: number) => formatHour(value)}
                  formatter={(value: number) => [formatValue(value, metricInfo.format), metricInfo.label]}
                />
                <Line name={metricInfo.label} type="linear" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} connectNulls={false} dot={{ r: 2.5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-2 rounded-md border border-border px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">ดูตัวเลขรายชั่วโมง</summary>
            <table className="mt-2 w-full">
              <thead><tr className="border-b text-left"><th className="py-1 font-medium" scope="col">ชั่วโมง</th><th className="py-1 text-right font-medium" scope="col">{metricInfo.label}</th></tr></thead>
              <tbody>
                {rows.map(({ minute, value }) => <tr key={minute} className="border-b last:border-0"><td className="tabular py-1">{formatHour(minute)}</td><td className="tabular py-1 text-right">{value === null ? "ไม่มีข้อมูล" : formatValue(value, metricInfo.format)}</td></tr>)}
              </tbody>
            </table>
          </details>
        </>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        GMV, ROI และออเดอร์อิงยอดที่ TikTok ผูกกับแคมเปญ ไม่ใช่ยอดรวมของร้าน · ROI Target ไม่ใช่ ROI จริง
        {payload?.observedAt ? ` · อ่านจาก TikTok ${formatTime(payload.observedAt)} (เวลาไทย)` : ""}
      </p>
    </section>
  );
}

export function AutomationPage() {
  const userId = useAuthStore((state) => state.user?.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const overview = useQuery({
    queryKey: ["automation", "overview", userId],
    queryFn: ({ signal }) => fetchAutomationOverview(signal),
    enabled: userId !== undefined,
    gcTime: 0,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => stopPolling(query.state.error) ? false : 60_000,
  });
  const data = overview.isSuccess ? overview.data : null;
  const now = Date.now();
  const enabled = data?.clients.filter((client) => isFreshAutomationClient(client, now) && client.campaign !== null) ?? [];
  const selected = enabled.find((client) => client.clientId === selectedId) ?? enabled[0] ?? null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/35">
      <div className="mx-auto grid max-w-7xl gap-4 p-3 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
              <Badge variant="secondary">ดูข้อมูลเท่านั้น</Badge>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">ดูสิทธิ์เข้าถึง แคมเปญที่เปิด และผลโฆษณา Creator โดยไม่ต้องรอข้อความ LINE</p>
          </div>
          <Button type="button" variant="outline" className="min-h-10" onClick={() => void overview.refetch()} disabled={overview.isFetching || stopPolling(overview.error)}>
            <RefreshCw className="h-4 w-4" aria-hidden /> อัปเดตสถานะ
          </Button>
        </div>
        {overview.isPending ? <LoadingState label="กำลังตรวจสอบสิทธิ์และสถานะแคมเปญ…" /> : overview.isError ? (
          <div className={SECTION}>
            {overview.error instanceof ApiError && overview.error.status === 403 ? (
              <EmptyState title="บัญชีนี้ยังไม่ได้รับสิทธิ์ Automation" description="สิทธิ์ดูรายงานเดิมไม่เท่ากับสิทธิ์ดูข้อมูล Creator กรุณาติดต่อผู้ดูแล" />
            ) : overview.error instanceof ApiError && overview.error.status === 404 ? (
              <EmptyState title="ยังไม่ได้เปิดแหล่งข้อมูล Automation" description="แท็บนี้จะไม่แสดงข้อมูลตัวอย่างเป็นสถานะจริง" />
            ) : <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />}
          </div>
        ) : data ? (
          <>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="h-4 w-4" aria-hidden /> ตรวจข้อมูลล่าสุด {formatTime(data.checkedAt)} (เวลาไทย) · อัปเดตประมาณทุก 1 นาที
            </p>
            <Stats clients={data.clients} now={now} />
            <AccessInventory clients={data.clients} now={now} />
            <CampaignCards clients={enabled} selectedId={selected?.clientId ?? null} onSelect={setSelectedId} />
            {selected && userId !== undefined ? <PerformancePanel key={`${selected.clientId}:${selected.campaign?.campaignId}:${selected.reportingDate}`} client={selected} userId={userId} /> : (
              <section className={SECTION} aria-labelledby="automation-performance">
                <h2 id="automation-performance" className="text-base font-semibold">Performance รายชั่วโมง</h2>
                <p className="mt-1 text-sm text-muted-foreground">กราฟจะแสดงเมื่อยืนยันแคมเปญที่เปิดอยู่และได้รับรายงานจาก TikTok</p>
              </section>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
