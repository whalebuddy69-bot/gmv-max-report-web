import { useState } from "react";
import { useQueries, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { Activity, ChevronDown, History, Users } from "lucide-react";
import { fetchAutomationPerformance, PILOT_BUDGET_CLIENT_ID, type AutomationClient, type AutomationOverview, type AutomationPerformance } from "@/api/automation";
import { fetchAdditionalBudgetCapStatus, fetchBudgetAutoOverviewStatus, fetchBudgetStatus, isBudgetCapClientId, type BudgetCapClientId } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { CreatorHistoricalPerformance } from "@/components/automation/CreatorHistoricalPerformance";
import { CreatorOverviewEdit } from "@/components/automation/CreatorOverviewEdit";
import { CreatorOverviewTable } from "@/components/automation/CreatorOverviewTable";
import { EmptyState } from "@/components/shared/StateViews";
import { Button } from "@/components/ui/button";
import { creatorRowPerformance, isFreshAutomationClient } from "@/lib/automation";
import { buildCreatorOverviewRow, selectedCreators, summarizeCreatorOverview, toggleCreatorSelection, type CreatorOverviewRow, type CreatorOverviewTotals, type CreatorSelection } from "@/lib/creatorOverview";

const metricFormat = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const moneyFormat = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 });
const summaries = [
  { key: "activeAccounts", label: "บัญชีที่ Run Ads", help: "บัญชีที่พบแคมเปญเปิดอยู่" },
  { key: "costMinor", label: "Cost", help: "ยอดใช้แอด" },
  { key: "gmvMinor", label: "GMV", help: "ยอดขายที่ TikTok นับให้แคมเปญ" },
  { key: "skuOrders", label: "SKU Orders", help: "จำนวนออเดอร์ราย SKU" },
  { key: "costPerOrderMinor", label: "Cost / Order", help: "ยอดใช้แอด ÷ SKU Orders" },
  { key: "liveViews", label: "LIVE Views", help: "ยอดวิวห้อง LIVE" },
  { key: "costPerLiveViewMinor", label: "Cost / LIVE View", help: "ยอดใช้แอด ÷ LIVE Views" },
] as const satisfies readonly { key: keyof CreatorOverviewTotals; label: string; help: string }[];

export function automationAccessDenied(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);
}

function performanceQuery(client: AutomationClient, userId: number, now: number): UseQueryOptions<AutomationPerformance, Error> {
  return {
    queryKey: ["automation", "performance", userId, client.clientId, client.campaign?.campaignId ?? null, client.reportingDate],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchAutomationPerformance(client.clientId, signal),
    enabled: isFreshAutomationClient(client, now) && client.campaign !== null,
    retry: false as const,
    staleTime: 120_000,
    refetchOnWindowFocus: false as const,
    refetchInterval: (query: { state: { error: unknown } }) => automationAccessDenied(query.state.error) ? false as const : 180_000,
  };
}

function CreatorFilter({ clients, selection, setSelection }: {
  clients: readonly AutomationClient[];
  selection: CreatorSelection;
  setSelection: (selection: CreatorSelection | ((current: CreatorSelection) => CreatorSelection)) => void;
}) {
  const knownIds = clients.map(({ clientId }) => clientId);
  const count = selectedCreators(clients, selection).length;
  return <details className="group w-full rounded-lg border border-border bg-card sm:w-auto">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
      <span className="flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" aria-hidden />{selection === null ? "บัญชีทั้งหมด" : `เลือก ${count} บัญชี`}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground group-open:rotate-180" aria-hidden />
    </summary>
    <div className="space-y-2 border-t border-border px-3 py-2 sm:min-w-64">
      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="ghost" size="sm" onClick={() => setSelection(null)}>เลือกทั้งหมด</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setSelection(new Set<string>())}>ล้างการเลือก</Button>
      </div>
      <div className="max-h-56 overflow-y-auto" role="group" aria-label="เลือกหลายบัญชี Creator">
        {clients.map((client) => <label key={client.clientId} className="flex min-h-10 cursor-pointer items-center gap-2 px-2 text-sm">
          <input type="checkbox" checked={selection === null || selection.has(client.clientId)} className="h-4 w-4 shrink-0 accent-primary"
            onChange={() => setSelection((current) => toggleCreatorSelection(current, client.clientId, knownIds))} />
          <span className="break-words">{client.displayName}</span>
        </label>)}
      </div>
    </div>
  </details>;
}

export function CreatorOverviewSummary({ rows }: { rows: readonly CreatorOverviewRow[] }) {
  const totals = summarizeCreatorOverview(rows);
  return <dl aria-label="สรุป Performance ของบัญชีที่เลือก" className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4 2xl:grid-cols-7">
    {summaries.map(({ key, label, help }) => {
      const { value, known, eligible } = totals[key];
      return <div key={key} className="min-w-0 rounded-lg border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
        <dt className="text-xs font-medium text-muted-foreground sm:text-sm">{label}</dt>
        <dd className="my-0.5 break-words text-lg font-semibold tabular-nums sm:text-xl">{value === null ? "—" : key.endsWith("Minor") ? moneyFormat.format(value / 100) : metricFormat.format(value)}</dd>
        <dd className="text-[11px] leading-snug text-muted-foreground">{help}</dd>
        {known < eligible && <dd className="mt-1 text-[11px] font-medium text-muted-foreground">มีข้อมูล {known}/{eligible} บัญชี</dd>}
      </div>;
    })}
  </dl>;
}

function HistoryPane({ client, userId, now }: { client: AutomationClient; userId: number; now: number }) {
  const result = useQuery(performanceQuery(client, userId, now));
  const payload = creatorRowPerformance(result.isSuccess ? result.data : undefined, client, Math.max(now, result.dataUpdatedAt));
  if (client.access === "verified" && !isFreshAutomationClient(client, now)) {
    return <EmptyState title="ยังไม่มีสถานะบัญชีล่าสุด" description="ลองกดอัปเดตสถานะด้านบนเพื่ออ่านรายงานของบัญชีนี้" />;
  }
  return <CreatorHistoricalPerformance client={client} result={result} payload={payload} />;
}

function OverviewPane({ clients, userId, now, onEdit }: {
  clients: readonly AutomationClient[];
  userId: number;
  now: number;
  onEdit: (clientId: string) => void;
}) {
  const budgetClients = clients.filter((client): client is AutomationClient & { clientId: BudgetCapClientId } => isBudgetCapClientId(client.clientId));
  const performance = useQueries({ queries: clients.map((client) => performanceQuery(client, userId, now)) });
  const caps = useQueries({ queries: budgetClients.map(({ clientId }) => ({
    queryKey: ["automation", clientId === PILOT_BUDGET_CLIENT_ID ? "budget-status" : "cap-status", userId, clientId],
    queryFn: ({ signal }: { signal: AbortSignal }) => clientId === PILOT_BUDGET_CLIENT_ID ? fetchBudgetStatus(signal, clientId) : fetchAdditionalBudgetCapStatus(clientId, signal),
    retry: false as const,
    staleTime: 30_000,
    refetchOnWindowFocus: false as const,
    refetchInterval: (query: { state: { error: unknown } }) => automationAccessDenied(query.state.error) ? false as const : 60_000,
  })) });
  const autos = useQueries({ queries: budgetClients.map(({ clientId }) => ({
    queryKey: ["automation", "budget-auto-overview", userId, clientId],
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchBudgetAutoOverviewStatus(clientId, signal),
    retry: false as const,
    staleTime: 30_000,
    refetchOnWindowFocus: false as const,
    refetchInterval: (query: { state: { error: unknown } }) => automationAccessDenied(query.state.error) ? false as const : 60_000,
  })) });
  const policies = new Map<string, { cap?: (typeof caps)[number]["data"]; auto?: (typeof autos)[number]["data"] }>(budgetClients.map(({ clientId }, index) => [clientId, {
    cap: caps[index]?.isSuccess ? caps[index].data : undefined,
    auto: autos[index]?.isSuccess ? autos[index].data : undefined,
  }]));
  const rows = clients.map((client, index) => {
    const result = performance[index];
    return buildCreatorOverviewRow(client, {
      ...policies.get(client.clientId),
      performance: result?.isSuccess ? result.data : undefined,
    }, Math.max(now, result?.dataUpdatedAt ?? 0));
  });

  return <>
    <CreatorOverviewSummary rows={rows} />
    <CreatorOverviewTable rows={rows} onEdit={onEdit} />
    <p className="text-xs leading-relaxed text-muted-foreground">
      Performance วันนี้รวมเฉพาะชั่วโมงที่ TikTok ส่งมาของแคมเปญที่เปิดอยู่ ไม่รวมแคมเปญที่จบหรือปิดแล้ว · การพบแคมเปญเปิดอยู่ไม่ได้ยืนยันว่ากำลังส่งโฆษณาหรือกำลัง LIVE · «—» คือไม่มีข้อมูลหรือยังคำนวณไม่ได้
    </p>
  </>;
}

export function CreatorOverviewDashboard({ data, userId, now, onSync, onRefreshCampaign }: {
  data: AutomationOverview;
  userId: number;
  now: number;
  onSync: () => Promise<AutomationOverview | null>;
  onRefreshCampaign: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const [selection, setSelection] = useState<CreatorSelection>(null);
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const [historyClientId, setHistoryClientId] = useState<string | null>(null);
  const editClient = data.clients.find(({ clientId }) => clientId === editClientId) ?? null;
  const historyClient = data.clients.find(({ clientId }) => clientId === historyClientId) ?? data.clients[0] ?? null;

  return <>
    <nav aria-label="มุมมอง Automation" className="flex flex-wrap items-center gap-1">
      <Button type="button" variant={tab === "overview" ? "secondary" : "ghost"} className="min-h-11" aria-pressed={tab === "overview"} onClick={() => setTab("overview")}>
        <Activity className="h-4 w-4" aria-hidden /> ภาพรวม
      </Button>
      <Button type="button" variant={tab === "history" ? "secondary" : "ghost"} className="min-h-11" aria-pressed={tab === "history"} onClick={() => setTab("history")}>
        <History className="h-4 w-4" aria-hidden /> รายงานตามช่วงเวลา
      </Button>
    </nav>
    {tab === "overview" ? <>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">บัญชี Creator</h2>
          <p className="text-xs text-muted-foreground">เลือกได้หลายบัญชี · Edit เพื่อดูและตั้งค่าเฉพาะบัญชีนั้น</p>
        </div>
        <CreatorFilter clients={data.clients} selection={selection} setSelection={setSelection} />
      </div>
      <OverviewPane clients={selectedCreators(data.clients, selection)} userId={userId} now={now} onEdit={setEditClientId} />
    </> : historyClient ? <>
      <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
        บัญชีสำหรับดูรายงาน
        <select className="min-h-11 max-w-full rounded-lg border border-input bg-card px-3 text-base sm:text-sm" value={historyClient.clientId} onChange={(event) => setHistoryClientId(event.target.value)}>
          {data.clients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName}</option>)}
        </select>
      </label>
      <HistoryPane key={historyClient.clientId} client={historyClient} userId={userId} now={now} />
    </> : <EmptyState title="ยังไม่มีบัญชี Creator" />}
    <CreatorOverviewEdit client={editClient} userId={userId} now={now}
      onClose={() => setEditClientId(null)} onSync={onSync} onRefreshCampaign={onRefreshCampaign} />
  </>;
}
