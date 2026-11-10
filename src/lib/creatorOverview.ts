import { isMonitoringOnlyCreator, type AutomationClient, type AutomationPerformance } from "@/api/automation";
import { supportsAutoWaitingForLive, VERIFIED_ROOM_SPEND_TREND, type BudgetAutoStatus, type BudgetCapStatus } from "@/api/automationBudget";
import { creatorRowPerformance, isFreshAutomationClient, totalForReturnedHours } from "@/lib/automation";
import { isPersistentAutoSession, persistentAutoHoldReason } from "@/lib/automationBudget";

export type CreatorOverviewRow = {
  clientId: string;
  displayName: string;
  tiktokUsername?: string | null;
  tiktokAccountId: string | null;
  monitoringOnly?: boolean;
  access: "verified" | "stale" | "unavailable";
  active: boolean | null;
  campaignName: string | null;
  scheduleTime: { startAt: string; endAt: string | null } | null;
  autoBudget: "on" | "off" | "pending" | "blocked" | "waiting-for-live" | "detecting-live" | "persistent-wait" | "persistent-paused" | null;
  totalBudgetMinor: number | null;
  maxBudgetMinor: number | null;
  viewerBoostBudgetMinor: number | null;
  roiTarget: number | null;
  roiActual?: number | null;
  costMinor: number | null;
  gmvMinor: number | null;
  skuOrders: number | null;
  costPerOrderMinor: number | null;
  liveViews: number | null;
  costPerLiveViewMinor: number | null;
};

export type CreatorSelection = ReadonlySet<string> | null;

/** null includes newly configured accounts; an explicit empty selection does not. */
export function selectedCreators<T extends { clientId: string }>(clients: readonly T[], selection: CreatorSelection) {
  return clients.filter(({ clientId }) => selection === null || selection.has(clientId));
}

export function toggleCreatorSelection(selection: CreatorSelection, clientId: string, knownIds: readonly string[]): CreatorSelection {
  if (!knownIds.includes(clientId)) return selection;
  const next = new Set(knownIds.filter((id) => selection === null || selection.has(id)));
  if (next.has(clientId)) next.delete(clientId);
  else next.add(clientId);
  return next.size === knownIds.length ? null : next;
}

function unitCost(cost: number | null, count: number | null) {
  return cost !== null && count !== null && count > 0 ? cost / count : null;
}

export function buildCreatorOverviewRow(client: AutomationClient, source: {
  performance?: AutomationPerformance;
  cap?: BudgetCapStatus;
  auto?: BudgetAutoStatus;
}, now: number): CreatorOverviewRow {
  const fresh = isFreshAutomationClient(client, now);
  const campaign = fresh ? client.campaign : null;
  const monitoringOnly = isMonitoringOnlyCreator(client);
  const performance = creatorRowPerformance(source.performance, client, now);
  const series = performance?.state === "available" ? performance.series : [];
  const costMinor = totalForReturnedHours(series, "spendMinor");
  const gmvMinor = totalForReturnedHours(series, "gmvMinor");
  const skuOrders = totalForReturnedHours(series, "orders");
  const liveViews = totalForReturnedHours(series, "liveViews");
  const auto = !monitoringOnly && source.auto?.clientId === client.clientId ? source.auto : undefined;
  const paused = auto && isPersistentAutoSession(auto) && (auto.overviewState === "blocked" ||
    (auto.overviewState === "on" && persistentAutoHoldReason(auto) !== null));
  const waitingForLive = auto?.overviewState === "on" && auto.mode === "live" && auto.strategy === "continuous"
    && auto.evidenceMode === VERIFIED_ROOM_SPEND_TREND && supportsAutoWaitingForLive(client.clientId)
    && auto.continuousSession?.status === "ARMED" && auto.continuousSession.waitingForLive === true;
  const waitingAuto = auto?.continuousSession?.keepAutoAcrossRooms === true ? "persistent-wait"
    : auto?.continuousSession?.autoDetectLive === true ? "detecting-live" : "waiting-for-live";
  return {
    clientId: client.clientId,
    displayName: client.displayName,
    tiktokUsername: client.tiktokUsername ?? null,
    tiktokAccountId: client.tiktokAccountId,
    monitoringOnly,
    access: fresh ? "verified" : client.access === "verified" ? "stale" : "unavailable",
    active: fresh ? campaign !== null : null,
    campaignName: campaign?.campaignName ?? null,
    scheduleTime: campaign?.scheduleStartAt ? { startAt: campaign.scheduleStartAt, endAt: campaign.scheduleEndAt ?? null } : null,
    autoBudget: paused ? "persistent-paused" : waitingForLive ? waitingAuto : auto?.overviewState ?? null,
    totalBudgetMinor: campaign?.dailyBudgetMinor ?? null,
    maxBudgetMinor: !monitoringOnly && source.cap?.clientId === client.clientId ? source.cap.cap?.clientDailyCapMinor ?? null : null,
    viewerBoostBudgetMinor: campaign?.viewerBoostBudgetMinor ?? null,
    roiTarget: campaign?.targetRoi ?? null,
    roiActual: costMinor !== null && costMinor > 0 && gmvMinor !== null ? gmvMinor / costMinor : null,
    costMinor,
    gmvMinor,
    skuOrders,
    costPerOrderMinor: unitCost(costMinor, skuOrders),
    liveViews,
    costPerLiveViewMinor: unitCost(costMinor, liveViews),
  };
}

type TotalMetric = "costMinor" | "gmvMinor" | "skuOrders" | "liveViews";
type Coverage = { value: number | null; known: number; eligible: number };
export type CreatorOverviewTotals = Record<TotalMetric | "activeAccounts" | "costPerOrderMinor" | "costPerLiveViewMinor", Coverage>;

function safeSum(values: readonly number[]) {
  if (!values.length) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number.isSafeInteger(total) ? total : null;
}

export function summarizeCreatorOverview(rows: readonly CreatorOverviewRow[]): CreatorOverviewTotals {
  const active = rows.filter((row) => row.active === true);
  const verified = rows.filter((row) => row.active !== null).length;
  const eligible = active.length + rows.length - verified;
  function total(key: TotalMetric): Coverage {
    const values = active.flatMap((row) => row[key] === null ? [] : [row[key]]);
    return { value: safeSum(values), known: values.length, eligible };
  }
  function weighted(key: "skuOrders" | "liveViews"): Coverage {
    // Use both metrics from the same account/report. A known zero still contributes its Cost.
    const pairs = active.flatMap((row) => row.costMinor !== null && row[key] !== null ? [{ cost: row.costMinor, count: row[key] }] : []);
    return { value: unitCost(safeSum(pairs.map(({ cost }) => cost)), safeSum(pairs.map(({ count }) => count))), known: pairs.length, eligible };
  }
  return {
    activeAccounts: { value: verified > 0 ? active.length : null, known: verified, eligible: rows.length },
    costMinor: total("costMinor"),
    gmvMinor: total("gmvMinor"),
    skuOrders: total("skuOrders"),
    costPerOrderMinor: weighted("skuOrders"),
    liveViews: total("liveViews"),
    costPerLiveViewMinor: weighted("liveViews"),
  };
}
