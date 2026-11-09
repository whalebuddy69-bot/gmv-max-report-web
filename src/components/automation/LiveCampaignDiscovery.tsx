import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, CircleHelp, RefreshCw, Search, Store, TriangleAlert, UserRound, UserRoundPlus } from "lucide-react";
import {
  enrollDiscoveredCreator,
  fetchAutomationLiveDiscovery,
  refreshAutomationLiveDiscovery,
  type AutomationCreatorEnrollment,
  type AutomationDiscoveredLiveCampaign,
  type AutomationLiveDiscovery,
} from "@/api/automationLiveDiscovery";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BANGKOK } from "@/lib/automation";
import { cn } from "@/lib/utils";
import { groupLiveDiscoveryCampaigns, type LiveDiscoveryGroup } from "./liveDiscoveryGroups";

const DEFAULT_VISIBLE_GROUPS = 6;
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

type AccountFilter = "all" | "creator" | "shop";
const accountFilters: ReadonlyArray<{ value: AccountFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "creator", label: "Creator" },
  { value: "shop", label: "Seller" },
];

export function filterDiscoveredLiveCampaigns(rows: readonly AutomationDiscoveredLiveCampaign[], search: string, kind: AccountFilter = "all") {
  const query = searchable(search);
  if (!query && kind === "all") return rows;
  return rows.filter((row) => (kind === "all" || row.kind === kind) && (!query || [
    row.tiktokUsername ? `@${row.tiktokUsername}` : "",
    row.advertiserName, row.advertiserId, row.campaignName, row.campaignId, row.shopName ?? "", row.shopId ?? "",
  ].some((value) => searchable(value).includes(query))));
}

type EnrollableCampaign = AutomationDiscoveredLiveCampaign & { kind: "creator"; tiktokUsername: string };
const NO_MANAGED_ADVERTISERS: ReadonlySet<string> = new Set<string>();

function eligibleCreator(row: AutomationDiscoveredLiveCampaign): row is EnrollableCampaign {
  return row.kind === "creator" && row.tiktokUsername !== null;
}

const campaignKey = (row: AutomationDiscoveredLiveCampaign) => `${row.advertiserId}:${row.campaignId}`;

function DiscoveryGroupStatus({ group }: { group: LiveDiscoveryGroup }) {
  const status = group.uniformStatus;
  const warning = group.warningCount > 0;
  return <div className="flex min-w-0 flex-col items-start gap-0.5">
    <Badge variant="outline" className="whitespace-nowrap px-1.5 py-0 text-[10px] leading-4">เปิดอยู่</Badge>
    {warning && <span className="flex min-w-0 max-w-full items-center gap-0.5 text-[10px] leading-3 text-warning"
      title={status ? providerStatusLabels[status] ?? "มีสถานะรองจาก TikTok" : `${group.warningCount} แคมเปญมีสถานะเตือนจาก TikTok`}>
      <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{status ? compactProviderStatus[status] ?? "สถานะอื่น" : `เตือน ${group.warningCount}`}</span>
    </span>}
    {group.unknownStatusCount > 0 && <span className="text-[9px] leading-3 text-muted-foreground" title="TikTok ไม่ได้ส่งสถานะการส่งโฆษณาของบางแคมเปญ">
      {group.unknownStatusCount === group.campaigns.length ? "ไม่ทราบการส่ง" : `ไม่ทราบ ${group.unknownStatusCount}`}
    </span>}
    {status === "CAMPAIGN_STATUS_ENABLE" && <span className="hidden text-[10px] leading-3 text-muted-foreground sm:inline">Active ตาม TikTok</span>}
  </div>;
}

type SelectCreator = (row: EnrollableCampaign, source: HTMLButtonElement) => void;

function FollowCreatorButton({ row, onSelect }: { row: EnrollableCampaign; onSelect: SelectCreator }) {
  return <Button type="button" variant="ghost" size="icon" className="size-10 shrink-0 text-primary hover:text-primary"
    aria-label={`เพิ่มในบัญชี Creator @${row.tiktokUsername}`} title={`ติดตาม @${row.tiktokUsername}`} onClick={(event) => onSelect(row, event.currentTarget)}>
    <UserRoundPlus className="size-[18px]" aria-hidden="true" />
  </Button>;
}

function DiscoveryGroupRows({ group, tracked, showFollowColumn, highlights, onSelect }: {
  group: LiveDiscoveryGroup;
  tracked: boolean;
  showFollowColumn: boolean;
  highlights: ReadonlySet<string> | null;
  onSelect?: SelectCreator;
}) {
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const typeLabel = group.kind === "creator" ? "ครีเอเตอร์" : group.kind === "shop" ? "ร้านค้า" : "ไม่ทราบประเภท";
  const TypeIcon = group.kind === "creator" ? UserRound : group.kind === "shop" ? Store : CircleHelp;
  const [singleAdvertiser] = group.advertisers;
  const [firstEnrollment] = group.creatorEnrollments;
  const chooseCreator = onSelect && group.creatorEnrollments.length > 1 ? onSelect : undefined;
  const displayScope = group.advertisers.length > 1 ? `${group.advertisers.length} Ad Accounts` : group.kind === "shop" ? singleAdvertiser?.name : null;
  const campaignCount = group.campaigns.length;
  return <tbody data-discovery-group={group.key} className="border-t border-border/65">
    <tr data-discovery-summary className={cn("hover:bg-muted/25", expanded && "bg-muted/35")}>
      <th scope="row" className="px-2 py-1.5 align-middle font-normal sm:px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <TypeIcon className={cn("size-4 shrink-0", group.kind === "unknown" ? "text-muted-foreground" : "text-primary")} aria-hidden="true" />
          <span className="min-w-0 sm:flex sm:items-baseline sm:gap-2">
            <span className="block truncate text-[10px] leading-3 text-muted-foreground sm:shrink-0 sm:text-xs">{typeLabel}</span>
            <span className="line-clamp-2 min-w-0 break-words text-xs font-semibold sm:block sm:truncate sm:text-sm" title={group.name}>{group.name}</span>
            {displayScope && <span className="hidden max-w-[38%] truncate text-[11px] text-muted-foreground md:block" title={displayScope}>· {displayScope}</span>}
          </span>
        </div>
      </th>
      <td className="px-1 py-1 align-middle sm:px-2"><DiscoveryGroupStatus group={group} /></td>
      <td className="px-1 py-0.5 text-center align-middle sm:px-2">
        <Button type="button" variant="outline" size="sm" data-discovery-expand className="h-9 gap-0.5 px-1.5 tabular-nums sm:gap-1.5 sm:px-2.5"
          aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? "ซ่อน" : "ดู"} ${campaignCount} แคมเปญของ ${group.name}`}
          onClick={() => setExpanded((open) => !open)}>
          {campaignCount}<span className="hidden sm:inline">แคมเปญ</span><ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden="true" />
        </Button>
      </td>
      {showFollowColumn && <td className="p-0 text-center align-middle">
        {tracked ? <span className="inline-flex size-10 items-center justify-center text-muted-foreground" title="Ad Account นี้มีในบัญชี Creator แล้ว">
          <Check className="size-4" aria-hidden="true" /><span className="sr-only">Ad Account นี้มีในบัญชี Creator แล้ว</span>
        </span> : onSelect && firstEnrollment && group.creatorEnrollments.length === 1 ? <FollowCreatorButton row={firstEnrollment} onSelect={onSelect} /> : chooseCreator ?
          <Button type="button" variant="ghost" size="icon" className="size-10 text-primary hover:text-primary" aria-controls={detailsId} aria-expanded={expanded}
            aria-label={`เลือกช่อง Creator เพื่อติดตามจาก ${group.name}`} title="เลือกช่อง Creator เพื่อติดตาม" onClick={() => setExpanded((open) => !open)}>
            <UserRoundPlus className="size-[18px]" aria-hidden="true" />
          </Button> : <span className="text-xs text-muted-foreground" aria-label="ไม่มีปุ่มติดตาม">—</span>}
      </td>}
    </tr>
    <tr id={detailsId} hidden={!expanded} data-discovery-detail>
      <td colSpan={showFollowColumn ? 4 : 3} className="bg-muted/20 px-1.5 pb-2 pt-1.5 sm:px-3">
        {expanded && <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground sm:text-xs">
            <strong className="break-words text-foreground">{group.name}</strong>
            {group.shopId && <span className="break-all tabular-nums">Shop ID {group.shopId}</span>}
            {group.advertisers.length === 1 && singleAdvertiser && <span className="break-words">Ad Account {group.kind === "shop" && <>{singleAdvertiser.name} · </>}
              <span className="break-all tabular-nums">{singleAdvertiser.id}</span></span>}
            {group.advertisers.length > 1 && <span>{group.advertisers.length} Ad Accounts</span>}
          </div>
          <table aria-label={`แคมเปญของ ${group.name}`} className="w-full table-fixed border-t border-border text-left text-[11px] leading-snug sm:text-xs">
            <thead className="bg-muted/45 text-[10px] font-medium text-muted-foreground sm:text-xs">
              <tr><th scope="col" className="w-[38%] px-1.5 py-1 sm:w-[45%] sm:px-2">แคมเปญ</th>
                <th scope="col" className="w-[32%] px-1.5 py-1 sm:w-[28%] sm:px-2">Campaign ID</th>
                <th scope="col" className="px-1.5 py-1 sm:px-2">TikTok username</th></tr>
            </thead>
            <tbody className="divide-y divide-border/65">{group.campaigns.map((row) => <tr key={campaignKey(row)} className={cn(highlights?.has(campaignKey(row)) && "bg-primary/5")}>
              <th scope="row" className="break-words px-1.5 py-1.5 align-top font-medium sm:px-2">{row.campaignName}
                {group.advertisers.length > 1 && <span className="mt-0.5 block break-words text-[10px] font-normal text-muted-foreground" title={`Ad Account ${row.advertiserId}`}>
                  {row.advertiserName} · <span className="break-all font-mono">{row.advertiserId}</span>
                </span>}
              </th>
              <td className="select-all break-all px-1.5 py-1.5 align-top font-mono text-[10px] sm:px-2 sm:text-xs">{row.campaignId}</td>
              <td className="break-all px-1.5 py-1.5 align-top sm:px-2">
                {row.tiktokUsername ? `@${row.tiktokUsername}` : <span className="break-words text-muted-foreground">ยังไม่ยืนยัน</span>}
                {chooseCreator && eligibleCreator(row) && group.creatorEnrollments.some(candidate => campaignKey(candidate) === campaignKey(row)) &&
                  <FollowCreatorButton row={row} onSelect={chooseCreator} />}
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
      </td>
    </tr>
  </tbody>;
}

export function LiveCampaignDiscoveryContent({ snapshot, pending, refreshing, error, onRefresh, managedAdvertiserIds = NO_MANAGED_ADVERTISERS, onSelectCreator, announcement }: {
  snapshot: AutomationLiveDiscovery | undefined;
  pending: boolean;
  refreshing: boolean;
  error: boolean;
  onRefresh: () => void;
  managedAdvertiserIds?: ReadonlySet<string>;
  onSelectCreator?: SelectCreator;
  announcement?: string;
}) {
  const headingId = useId();
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const rows = snapshot?.campaigns ?? [];
  const matched = new Set(filterDiscoveredLiveCampaigns(rows, search, accountFilter).map(campaignKey));
  // A search for one campaign finds its group without hiding the other channels
  // or reducing the group's real campaign count.
  const matchedGroups = groupLiveDiscoveryCampaigns(rows).filter(group => group.campaigns.some(row => matched.has(campaignKey(row))));
  const visible = showAll ? matchedGroups : matchedGroups.slice(0, DEFAULT_VISIBLE_GROUPS);
  const highlights = search.trim() ? matched : null;
  const advertiserCount = new Set(rows.map((row) => row.advertiserId)).size;
  const hasCoverage = snapshot !== undefined && (snapshot.checkedAt !== null || snapshot.accountsTotal > 0);
  const canAddCreators = snapshot?.canAddCreators === true && !refreshing && !error && (snapshot.state === "ready" || snapshot.state === "partial");
  const tracked = (group: LiveDiscoveryGroup) => group.kind === "creator" && group.advertisers.some(({ id }) => managedAdvertiserIds.has(id));
  const canFollow = (group: LiveDiscoveryGroup) => canAddCreators && !tracked(group) && group.creatorEnrollments.length > 0;
  const showFollowColumn = visible.some(group => tracked(group) || (onSelectCreator && canFollow(group)));
  return <section aria-labelledby={headingId} className="min-w-0 rounded-xl border border-border bg-card">
    <header className="flex flex-wrap items-start justify-between gap-2 px-2.5 pb-1.5 pt-2.5 sm:px-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-base font-semibold">LIVE GMV Max ที่เปิดสวิตช์</h2>
          <Badge variant="secondary">อ่านอย่างเดียว</Badge>
        </div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          จำนวนแคมเปญคือรายการที่ตรวจพบว่าเปิดสวิตช์ · ไม่ได้ยืนยันว่ากำลังไลฟ์หรือส่งโฆษณา · การไลฟ์ไม่เพิ่มสิทธิ์จัดการ
        </p>
        {canAddCreators && showFollowColumn && <p className="flex items-center gap-1 text-[11px] leading-relaxed text-muted-foreground"><UserRoundPlus className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> กดไอคอนท้ายแถว Creator เพื่อเพิ่มเข้าภาพรวมสำหรับติดตาม</p>}
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
      {announcement && <p role="status" className="text-xs text-foreground">{announcement}</p>}
      {rows.length > 0 && <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <div role="group" aria-label="กรองประเภทบัญชี" className="flex min-w-0 rounded-lg border border-input p-0.5">
          {accountFilters.map(({ value, label }) => <Button key={value} type="button" size="sm" variant={accountFilter === value ? "secondary" : "ghost"}
            className="min-h-9 px-2.5" aria-pressed={accountFilter === value} onClick={() => { setAccountFilter(value); setShowAll(false); }}>
            {label}
          </Button>)}
        </div>
        <div className="relative min-w-0 grow basis-40 sm:max-w-md">
          <label htmlFor={searchId} className="sr-only">ค้นหารายการ LIVE</label>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input id={searchId} type="search" autoComplete="off" value={search} className="h-9 pl-8 text-base placeholder:text-xs sm:text-sm"
            placeholder="ค้นหา @username, ร้าน, บัญชี หรือแคมเปญ"
            onChange={(event) => { setSearch(event.target.value); setShowAll(false); }} />
        </div>
      </div>}
      {rows.length === 0 && snapshot?.state === "ready" && !error && <p className="text-sm text-muted-foreground">
        ไม่พบแคมเปญ LIVE GMV Max ที่เปิดสวิตช์ในบัญชีที่ตรวจได้
      </p>}
      {rows.length > 0 && matchedGroups.length === 0 && <p className="text-sm text-muted-foreground">ไม่พบรายการที่ตรงกับตัวกรอง</p>}
    </div>
    {visible.length > 0 && <table className="w-full table-fixed border-t border-border text-left">
      <caption className="sr-only">รายการแคมเปญ LIVE ที่เปิดสวิตช์</caption>
      <thead className="bg-muted/65 text-[10px] text-muted-foreground sm:text-xs">
        <tr>
          <th scope="col" className="px-2 py-1.5 font-semibold sm:px-3">บัญชี / ร้านค้า</th>
          <th scope="col" className="w-[4.5rem] px-1 py-1.5 font-semibold sm:w-32 sm:px-2">สถานะ</th>
          <th scope="col" className="w-[3.75rem] px-1 py-1.5 text-center font-semibold sm:w-28 sm:px-2">แคมเปญ</th>
          {showFollowColumn && <th scope="col" className="w-11 px-0.5 py-1.5 text-center font-semibold sm:w-16">ติดตาม</th>}
        </tr>
      </thead>
      {visible.map((group) => <DiscoveryGroupRows key={group.key} group={group} tracked={tracked(group)} showFollowColumn={showFollowColumn}
        highlights={highlights} onSelect={canFollow(group) ? onSelectCreator : undefined} />)}
    </table>}
    {matchedGroups.length > DEFAULT_VISIBLE_GROUPS && <footer className="border-t border-border px-2.5 py-1 sm:px-3">
      <Button type="button" variant="ghost" size="sm" className="min-h-10" aria-expanded={showAll}
        onClick={() => setShowAll(!showAll)}>
        {showAll ? `แสดง ${DEFAULT_VISIBLE_GROUPS} กลุ่มแรก` : `แสดงทั้งหมด ${matchedGroups.length} กลุ่ม`}
      </Button>
    </footer>}
  </section>;
}

function enrollmentError(error: unknown) {
  if (!(error instanceof ApiError)) return "ยังยืนยันผลการเพิ่มบัญชีไม่ได้ กรุณาตรวจรายการบัญชีแล้วลองใหม่";
  if (error.status === 401 || error.status === 403) return "บัญชีนี้ไม่ได้รับสิทธิ์เพิ่ม Creator";
  if (error.status === 404 || error.status === 409 || error.status === 422) return "ไม่สามารถยืนยันบัญชีนี้ได้ กรุณาปิดหน้าต่างและรีเฟรช LIVE ก่อนลองใหม่";
  if (error.status === 429) return "มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่";
  return "ยังยืนยันผลการเพิ่มบัญชีไม่ได้ กรุณาตรวจรายการบัญชีแล้วลองใหม่";
}

export function LiveCampaignDiscovery({ userId, managedAdvertiserIds = NO_MANAGED_ADVERTISERS, onManagedAdded }: {
  userId: number;
  managedAdvertiserIds?: ReadonlySet<string>;
  onManagedAdded?: (result: AutomationCreatorEnrollment) => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["automation", "live-discovery", userId] as const;
  const manualRequest = useRef<AbortController | null>(null);
  const enrollRequest = useRef<AbortController | null>(null);
  const addTrigger = useRef<HTMLButtonElement | null>(null);
  const addFallback = useRef<HTMLElement | null>(null);
  const fastPollStartedAt = useRef<number | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [selected, setSelected] = useState<EnrollableCampaign | null>(null);
  const [recentlyAdded, setRecentlyAdded] = useState<ReadonlySet<string>>(NO_MANAGED_ADVERTISERS);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => () => {
    manualRequest.current?.abort();
    enrollRequest.current?.abort();
  }, []);

  const enrollment = useMutation({
    mutationKey: ["automation", "live-discovery-enroll", userId],
    retry: false,
    gcTime: 0,
    mutationFn: ({ row, controller }: { row: EnrollableCampaign; controller: AbortController }) =>
      enrollDiscoveredCreator({ advertiserId: row.advertiserId, campaignId: row.campaignId, expectedUsername: row.tiktokUsername }, controller.signal),
    async onSuccess(result, { row, controller }) {
      if (controller.signal.aborted) return;
      setRecentlyAdded((previous) => new Set([...previous, result.advertiserId]));
      setSelected(null);
      const prefix = `เพิ่ม @${row.tiktokUsername} สำหรับติดตามแล้ว`;
      setAnnouncement(prefix);
      let visible = false;
      try {
        visible = await onManagedAdded?.(result) === true;
      } catch {
        // The save already succeeded. Do not present a sync error as a failed save.
      }
      if (!visible && !controller.signal.aborted) setAnnouncement(`${prefix} · หากยังไม่เห็นในตาราง ให้กดอัปเดตสถานะ`);
    },
    onSettled(_result, _error, { controller }) {
      if (enrollRequest.current === controller) enrollRequest.current = null;
    },
  });

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
    if (denied) {
      enrollRequest.current?.abort();
      setRevoked(true);
    }
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

  const managed = new Set([...managedAdvertiserIds, ...recentlyAdded]);
  const canConfirm = selected !== null && query.data?.canAddCreators === true
    && (query.data.state === "ready" || query.data.state === "partial") && !query.isError && !refresh.isPending && !refresh.isError
    && !managed.has(selected.advertiserId) && query.data.campaigns.some((row) => eligibleCreator(row)
      && row.advertiserId === selected.advertiserId && row.campaignId === selected.campaignId && row.tiktokUsername === selected.tiktokUsername);
  function confirm() {
    if (!selected || !canConfirm || enrollRequest.current) return;
    const controller = new AbortController();
    enrollRequest.current = controller;
    enrollment.mutate({ row: selected, controller });
  }

  return <>
    <LiveCampaignDiscoveryContent snapshot={query.data} pending={query.isPending && !query.isError}
      refreshing={refresh.isPending || query.data?.state === "refreshing"} error={query.isError || refresh.isError}
      onRefresh={() => void refreshNow()} managedAdvertiserIds={managed} announcement={announcement}
      onSelectCreator={(row, source) => {
        if (enrollRequest.current || refresh.isPending) return;
        enrollment.reset();
        setAnnouncement("");
        addTrigger.current = source;
        addFallback.current = source.closest("tbody[data-discovery-group]")?.querySelector<HTMLElement>("[data-discovery-expand]") ?? null;
        setSelected(row);
      }} />
    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open && !enrollRequest.current) setSelected(null); }}>
      <DialogContent className="inset-x-0 bottom-0 top-auto max-h-[calc(100dvh-1rem)] max-w-none translate-x-0 translate-y-0 gap-3 overflow-y-auto rounded-b-none rounded-t-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 [&>button]:grid [&>button]:size-10 [&>button]:place-items-center sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:w-[calc(100%-2rem)] sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
        onCloseAutoFocus={(event) => {
          const target = addTrigger.current?.isConnected ? addTrigger.current : addFallback.current;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus({ preventScroll: true });
          }
        }}>
        <div className="min-w-0 space-y-1 pr-12">
          <DialogTitle>เพิ่ม Creator เพื่อติดตาม</DialogTitle>
          <DialogDescription>ดูแคมเปญและผลในภาพรวม โดยไม่เปลี่ยนแคมเปญ งบ หรือเปิด Auto Budget</DialogDescription>
        </div>
        {selected && <dl className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-muted/45 p-3 text-sm">
          <dt className="text-muted-foreground">บัญชี TikTok</dt><dd className="break-all font-medium">@{selected.tiktokUsername}</dd>
          <dt className="text-muted-foreground">Ad Account ID</dt><dd className="break-all tabular-nums">{selected.advertiserId}</dd>
          <dt className="text-muted-foreground">Campaign ID</dt><dd className="break-all tabular-nums">{selected.campaignId}</dd>
        </dl>}
        {enrollment.isError && <p role="alert" className="text-sm text-warning">{enrollmentError(enrollment.error)}</p>}
        {!canConfirm && !enrollment.isPending && !enrollment.isError && <p role="status" className="text-xs text-muted-foreground">
          ยังยืนยันรายการล่าสุดไม่ได้ กรุณาปิดหน้าต่างและตรวจรายการ LIVE อีกครั้ง
        </p>}
        <div className="grid gap-2 sm:flex sm:justify-end">
          <Button type="button" variant="outline" className="min-h-11" disabled={enrollment.isPending} onClick={() => setSelected(null)}>ยกเลิก</Button>
          <Button type="button" className="min-h-11" disabled={!canConfirm || enrollment.isPending} onClick={confirm}>
            {enrollment.isPending ? "กำลังเพิ่มบัญชี…" : "ยืนยันเพิ่มเพื่อติดตาม"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
