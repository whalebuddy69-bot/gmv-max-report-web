import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw, Search, Store } from "lucide-react";
import {
  fetchAutomationLiveDiscovery,
  refreshAutomationLiveDiscovery,
  type AutomationDiscoveredLiveCampaign,
  type AutomationLiveDiscovery,
} from "@/api/automationLiveDiscovery";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BANGKOK } from "@/lib/automation";
import { cn } from "@/lib/utils";

const DEFAULT_VISIBLE_ROWS = 6;
const REFRESHING_POLL_MS = 10_000;
const IDLE_POLL_MS = 60_000;
const MAX_FAST_POLL_MS = 4 * 60_000;
const checkedTime = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, dateStyle: "medium", timeStyle: "short" });

const providerStatusLabels: Readonly<Record<string, string>> = Object.freeze({
  CAMPAIGN_STATUS_ENABLE: "Active ตาม TikTok",
  CAMPAIGN_STATUS_BUDGET_EXCEED: "งบแคมเปญหมด",
  CAMPAIGN_STATUS_TTS_ACCOUNT_BALANCE_INSUFFICIENT: "ยอดเงินในบัญชีไม่พอ",
  CAMPAIGN_STATUS_REVIEW_DISAPPROVED: "ไม่ผ่านการตรวจ",
  CAMPAIGN_STATUS_AWAITING_RELEASE: "รอเริ่มส่งโฆษณา",
  CAMPAIGN_STATUS_TTS_TT_ASSET_UNAVAILABLE: "Asset ไม่พร้อมส่งโฆษณา",
  CAMPAIGN_STATUS_TTS_TT_IDENTITY_UNAVAILABLE: "บัญชี TikTok ไม่พร้อม",
  CAMPAIGN_STATUS_TIKTOK_SHOP_UNAVAILABLE: "ร้านค้าไม่พร้อม",
  CAMPAIGN_STATUS_AD_UNAVAILABLE: "ไม่มีแอดพร้อมส่ง",
  CAMPAIGN_STATUS_LIVE_GMV_MAX_AUTHORIZATION_CANCEL: "สิทธิ์ LIVE GMV Max เปลี่ยน",
});
const compactProviderStatus: Readonly<Record<string, string>> = Object.freeze({
  CAMPAIGN_STATUS_ENABLE: "Active",
  CAMPAIGN_STATUS_BUDGET_EXCEED: "งบหมด",
  CAMPAIGN_STATUS_TTS_ACCOUNT_BALANCE_INSUFFICIENT: "เงินไม่พอ",
  CAMPAIGN_STATUS_REVIEW_DISAPPROVED: "ไม่ผ่านการตรวจ",
  CAMPAIGN_STATUS_AWAITING_RELEASE: "รอเริ่มส่ง",
  CAMPAIGN_STATUS_TTS_TT_ASSET_UNAVAILABLE: "Asset ไม่พร้อม",
  CAMPAIGN_STATUS_TTS_TT_IDENTITY_UNAVAILABLE: "บัญชีไม่พร้อม",
  CAMPAIGN_STATUS_TIKTOK_SHOP_UNAVAILABLE: "ร้านไม่พร้อม",
  CAMPAIGN_STATUS_AD_UNAVAILABLE: "แอดไม่พร้อม",
  CAMPAIGN_STATUS_LIVE_GMV_MAX_AUTHORIZATION_CANCEL: "สิทธิ์เปลี่ยน",
});

function accessDenied(error: unknown) {
  return error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0);
}

export function liveDiscoveryPollingInterval(snapshot: AutomationLiveDiscovery | undefined, error: unknown, refreshingForMs: number) {
  if (accessDenied(error)) return false;
  return !error && snapshot?.state === "refreshing" && refreshingForMs < MAX_FAST_POLL_MS ? REFRESHING_POLL_MS : IDLE_POLL_MS;
}

const searchable = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("th-TH");

export function filterDiscoveredLiveCampaigns(rows: readonly AutomationDiscoveredLiveCampaign[], search: string) {
  const query = searchable(search);
  if (!query) return rows;
  return rows.filter((row) => [
    row.tiktokUsername ? `@${row.tiktokUsername}` : "",
    row.advertiserName, row.advertiserId, row.campaignName, row.campaignId, row.shopName ?? "", row.shopId ?? "",
  ].some((value) => searchable(value).includes(query)));
}

function groupByAdvertiser(rows: readonly AutomationDiscoveredLiveCampaign[]) {
  const groups = new Map<string, { id: string; name: string; campaigns: AutomationDiscoveredLiveCampaign[] }>();
  for (const campaign of rows) {
    const group = groups.get(campaign.advertiserId);
    if (group) group.campaigns.push(campaign);
    else groups.set(campaign.advertiserId, { id: campaign.advertiserId, name: campaign.advertiserName, campaigns: [campaign] });
  }
  return [...groups.values()];
}

function DiscoveryRow({ campaign }: { campaign: AutomationDiscoveredLiveCampaign }) {
  const secondaryStatus = campaign.secondaryStatus;
  const providerLabel = secondaryStatus ? providerStatusLabels[secondaryStatus] ?? "มีสถานะรองจาก TikTok" : "ไม่มีสถานะการส่งโฆษณาจาก TikTok";
  const compactStatus = secondaryStatus ? compactProviderStatus[secondaryStatus] ?? "มีสถานะรอง" : null;
  const username = campaign.tiktokUsername ? `@${campaign.tiktokUsername}` : null;
  const shopLabel = campaign.shopName ? `ร้านค้า · ${campaign.shopName}` : "ร้านค้า · ยังไม่ทราบชื่อ";
  return <li className="min-w-0">
    <details className="group/row">
      <summary className="grid min-h-11 min-w-0 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-2.5 py-1 text-left hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:px-3 [&::-webkit-details-marker]:hidden">
        <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5">
          {username && <span className={cn("truncate text-xs font-semibold sm:text-sm", campaign.kind === "shop" && "max-w-[55%]")} title={username}>{username}</span>}
          {campaign.kind === "shop" && <span className={cn("inline-flex min-w-0 items-center gap-1 text-xs", username ? "text-muted-foreground" : "font-semibold")}>
            <Store className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="truncate" title={shopLabel}>{shopLabel}</span>
          </span>}
          {!username && campaign.kind !== "shop" && <span className="truncate text-xs text-muted-foreground">ยังไม่ยืนยัน @username</span>}
        </span>
        <span className="col-start-1 row-start-2 truncate text-xs leading-4 text-muted-foreground sm:col-start-2 sm:row-start-1 sm:text-foreground"
          title={campaign.campaignName}>{campaign.campaignName}</span>
        <span className="col-start-2 row-span-2 row-start-1 flex items-center gap-1.5 justify-self-end sm:col-start-3 sm:row-span-1">
          <span className="flex flex-col items-end whitespace-nowrap" title={providerLabel}>
            <span className="text-[11px] font-medium leading-4">เปิดอยู่</span>
            {compactStatus && <span className={cn("text-[10px] leading-3", secondaryStatus === "CAMPAIGN_STATUS_ENABLE" ? "text-muted-foreground" : "text-warning")}>{compactStatus}</span>}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/row:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          <span className="sr-only">ดูรายละเอียดแคมเปญ</span>
        </span>
      </summary>
      <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-t border-border/50 bg-muted/20 px-2.5 py-2 text-xs leading-relaxed sm:px-3">
        <dt className="text-muted-foreground">แคมเปญ</dt><dd className="break-words">{campaign.campaignName}</dd>
        <dt className="text-muted-foreground">Campaign ID</dt><dd className="break-all tabular-nums">{campaign.campaignId}</dd>
        <dt className="text-muted-foreground">บัญชี TikTok</dt><dd className="break-all">{username ?? "ยังไม่ยืนยัน @username"}</dd>
        {campaign.kind === "shop" && <>
          <dt className="text-muted-foreground">ร้านค้า</dt><dd className="break-words">{campaign.shopName ?? "ยังไม่ทราบชื่อร้าน"}</dd>
          {campaign.shopId && <><dt className="text-muted-foreground">รหัสร้านค้า</dt><dd className="break-all tabular-nums">Shop ID {campaign.shopId}</dd></>}
        </>}
        {campaign.kind === "unknown" && <><dt className="text-muted-foreground">ประเภท</dt><dd>ยังไม่ยืนยันประเภท</dd></>}
        <dt className="text-muted-foreground">สถานะ</dt><dd className="break-words" title={secondaryStatus ?? undefined}>เปิดอยู่ · {providerLabel}</dd>
      </dl>
    </details>
  </li>;
}

export function LiveCampaignDiscoveryContent({ snapshot, pending, refreshing, error, onRefresh }: {
  snapshot: AutomationLiveDiscovery | undefined;
  pending: boolean;
  refreshing: boolean;
  error: boolean;
  onRefresh: () => void;
}) {
  const headingId = useId();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const rows = snapshot?.campaigns ?? [];
  const matched = filterDiscoveredLiveCampaigns(rows, search);
  const visible = showAll ? matched : matched.slice(0, DEFAULT_VISIBLE_ROWS);
  const groups = groupByAdvertiser(visible);
  const advertiserCount = new Set(rows.map((row) => row.advertiserId)).size;
  const hasCoverage = snapshot !== undefined && (snapshot.checkedAt !== null || snapshot.accountsTotal > 0);
  return <section aria-labelledby={headingId} className="min-w-0 rounded-xl border border-border bg-card">
    <header className="flex flex-wrap items-start justify-between gap-2 px-2.5 pb-1.5 pt-2.5 sm:px-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-base font-semibold">LIVE GMV Max ที่เปิดสวิตช์</h2>
          <Badge variant="secondary">อ่านอย่างเดียว</Badge>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          เปิดอยู่คือสถานะสวิตช์ ไม่ได้ยืนยันว่ากำลังไลฟ์หรือส่งโฆษณา · การไลฟ์ไม่เพิ่มสิทธิ์จัดการ
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" className="min-h-10 shrink-0"
        disabled={pending || refreshing} onClick={onRefresh}>
        <RefreshCw className={cn("h-4 w-4", (pending || refreshing) && "motion-safe:animate-spin")} aria-hidden="true" />
        {pending || refreshing ? "กำลังรีเฟรช" : "รีเฟรช LIVE"}
      </Button>
    </header>
    <div className="space-y-1.5 px-2.5 pb-2 sm:px-3">
      {hasCoverage && <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{rows.length} แคมเปญใน {advertiserCount} Ad Accounts</span>
        <span>· ตรวจครบ {snapshot.accountsChecked}/{snapshot.accountsTotal} บัญชี</span>
        {snapshot.checkedAt && <span>· รอบล่าสุด {checkedTime.format(new Date(snapshot.checkedAt))} (เวลาไทย)</span>}
      </p>}
      {(pending || refreshing) && <p role="status" className="text-xs text-muted-foreground">
        {hasCoverage ? "กำลังอัปเดตรายการ · แสดงข้อมูลจากรอบล่าสุดระหว่างรอ" : "กำลังอ่านรายการจาก TikTok"}
      </p>}
      {snapshot?.state === "partial" && <p role="status" className="text-xs text-warning">
        ตรวจได้ไม่ครบ · รายการที่เห็นเป็นเฉพาะบัญชีหรือแคมเปญที่อ่านได้
      </p>}
      {(error || snapshot?.state === "unavailable") && <p role="status" className="text-xs text-warning">
        {rows.length ? "อัปเดตรอบใหม่ไม่สำเร็จ · แสดงรายการจากรอบล่าสุด" : "ยังอ่านรายการ LIVE จาก TikTok ไม่สำเร็จ · ไม่ได้หมายความว่าไม่มีแคมเปญเปิด"}
      </p>}
      {rows.length > 0 && <div className="relative max-w-md">
        <label htmlFor={searchId} className="sr-only">ค้นหารายการ LIVE</label>
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <Input id={searchId} type="search" autoComplete="off" value={search} className="h-9 pl-8 text-base placeholder:text-xs sm:text-sm"
          placeholder="ค้นหา @username, ร้าน, บัญชี หรือแคมเปญ"
          onChange={(event) => { setSearch(event.target.value); setShowAll(false); }} />
      </div>}
      {rows.length === 0 && snapshot?.state === "ready" && !error && <p className="text-sm text-muted-foreground">
        ไม่พบแคมเปญ LIVE GMV Max ที่เปิดสวิตช์ในบัญชีที่ตรวจได้
      </p>}
      {rows.length > 0 && matched.length === 0 && <p className="text-sm text-muted-foreground">ไม่พบรายการที่ตรงกับคำค้น</p>}
    </div>
    {groups.length > 0 && <div role="region" aria-label="รายการแคมเปญ LIVE ที่เปิดสวิตช์" className="divide-y divide-border border-t border-border">
      {groups.map(({ id, name, campaigns }) => <div key={id}>
        <div className="flex min-w-0 items-baseline gap-x-2 bg-muted/35 px-2.5 py-0.5 sm:px-3">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={name}>{name}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">Ad Account {id}</span>
        </div>
        <ul aria-label={`แคมเปญของ ${name}`} className="divide-y divide-border/60">
          {campaigns.map((campaign) => <DiscoveryRow key={campaign.campaignId} campaign={campaign} />)}
        </ul>
      </div>)}
    </div>}
    {matched.length > DEFAULT_VISIBLE_ROWS && <footer className="border-t border-border px-2.5 py-1 sm:px-3">
      <Button type="button" variant="ghost" size="sm" className="min-h-10" aria-expanded={showAll}
        onClick={() => setShowAll(!showAll)}>
        {showAll ? `แสดง ${DEFAULT_VISIBLE_ROWS} รายการแรก` : `แสดงทั้งหมด ${matched.length} รายการ`}
      </Button>
    </footer>}
  </section>;
}

export function LiveCampaignDiscovery({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const queryKey = ["automation", "live-discovery", userId] as const;
  const manualRequest = useRef<AbortController | null>(null);
  const fastPollStartedAt = useRef<number | null>(null);
  const [revoked, setRevoked] = useState(false);
  useEffect(() => () => manualRequest.current?.abort(), []);

  const refresh = useMutation({
    mutationKey: ["automation", "live-discovery-refresh", userId],
    retry: false,
    gcTime: 0,
    mutationFn: (controller: AbortController) => refreshAutomationLiveDiscovery(controller.signal),
    onSuccess(snapshot, controller) {
      if (!controller.signal.aborted) {
        fastPollStartedAt.current = null;
        queryClient.setQueryData(queryKey, snapshot);
      }
    },
    onSettled(_data, _error, controller) {
      if (manualRequest.current === controller) manualRequest.current = null;
    },
  });
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchAutomationLiveDiscovery(signal),
    enabled: !revoked && !refresh.isPending && !accessDenied(refresh.error),
    gcTime: 0,
    retry: false,
    staleTime: REFRESHING_POLL_MS,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: ({ state }) => {
      const now = Date.now();
      if (state.data?.state === "refreshing") fastPollStartedAt.current ??= now;
      else fastPollStartedAt.current = null;
      return liveDiscoveryPollingInterval(state.data, state.error, fastPollStartedAt.current === null ? 0 : now - fastPollStartedAt.current);
    },
  });
  // Do not retain a previously read account inventory when the endpoint
  // revokes its operator-only authorization. Disable polling before removal.
  const denied = accessDenied(query.error) || accessDenied(refresh.error);
  useEffect(() => {
    if (denied) setRevoked(true);
  }, [denied]);
  useEffect(() => {
    if (revoked) queryClient.removeQueries({ queryKey: ["automation", "live-discovery", userId], exact: true });
  }, [queryClient, revoked, userId]);
  if (revoked || denied) return null;

  async function refreshNow() {
    if (manualRequest.current) return;
    const controller = new AbortController();
    manualRequest.current = controller;
    await queryClient.cancelQueries({ queryKey, exact: true });
    if (!controller.signal.aborted) refresh.mutate(controller);
  }

  return <LiveCampaignDiscoveryContent snapshot={query.data} pending={query.isPending && !query.isError}
    refreshing={refresh.isPending || query.data?.state === "refreshing"} error={query.isError || refresh.isError}
    onRefresh={() => void refreshNow()} />;
}
