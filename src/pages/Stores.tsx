import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Check,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Info,
  Lock,
  PauseCircle,
  RefreshCcw,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import type {
  AuthorizeOutcome,
  StoreAuthorizationRow,
  StoreAuthorizationStatus,
} from "@/types/storeAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingState, WarningList } from "@/components/shared/StateViews";
import { createAuthorizeLink, fetchStoreAuthorization } from "@/api/analytics";
import { fetchSyncStatus, startStoreSync, targetKey } from "@/api/sync";
import { formatDateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface StatusStyle {
  label: string;
  icon: typeof CheckCircle2;
  /** Badge classes. */
  badge: string;
  /** Icon-only tint, for the summary chips. */
  tint: string;
  /** Needs the operator to do something. */
  needsAttention: boolean;
}

const STATUS_STYLES: Record<StoreAuthorizationStatus, StatusStyle> = {
  ok: {
    label: "ดึงข้อมูลได้",
    icon: CheckCircle2,
    badge: "border-transparent bg-success/15 text-success",
    tint: "text-success",
    needsAttention: false,
  },
  notAuthorized: {
    label: "ยังไม่ได้ authorize",
    icon: Lock,
    badge: "border-transparent bg-destructive/15 text-destructive",
    tint: "text-destructive",
    needsAttention: true,
  },
  syncError: {
    label: "sync ล้มเหลว",
    icon: XCircle,
    badge: "border-transparent bg-destructive/15 text-destructive",
    tint: "text-destructive",
    needsAttention: true,
  },
  gmvMaxUnavailable: {
    label: "GMV Max ไม่เปิด",
    icon: AlertTriangle,
    badge: "border-transparent bg-warning/15 text-warning",
    tint: "text-warning",
    needsAttention: true,
  },
  noData: {
    label: "ไม่มีข้อมูล",
    icon: Info,
    badge: "border-transparent bg-warning/15 text-warning",
    tint: "text-warning",
    needsAttention: true,
  },
  notDiscovered: {
    label: "ยังไม่เข้ารายการ sync",
    icon: Clock,
    badge: "border-transparent bg-warning/15 text-warning",
    tint: "text-warning",
    needsAttention: true,
  },
  syncDisabled: {
    label: "ปิด sync ไว้",
    icon: PauseCircle,
    badge: "border-transparent bg-secondary text-secondary-foreground",
    tint: "text-muted-foreground",
    needsAttention: false,
  },
};

const STATUS_ORDER = Object.keys(STATUS_STYLES) as StoreAuthorizationStatus[];

/** Statuses the scheduled sync will clear by itself */
const SELF_HEALING: ReadonlySet<StoreAuthorizationStatus> = new Set(["syncError", "noData"]);

/** "attention" and "all" sit alongside the individual statuses in one control. */
type Filter = "all" | "attention" | StoreAuthorizationStatus;

export function StoresPage() {
  const [filter, setFilter] = useState<Filter>("attention");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  /* Fetches with `refresh` explicitly and writes the answer into the cache */
  const handleRefresh = useCallback(async (): Promise<void> => {
    setIsRefreshing(true);
    try {
      const data = await fetchStoreAuthorization(true);
      queryClient.setQueryData(["gmv", "storeAuthorization"], data);
    } catch {
      // Leave the last good list on screen and let the query surface the failure on its next
      // natural fetch
      await queryClient.invalidateQueries({ queryKey: ["gmv", "storeAuthorization"] });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  /* The other half of the authorize flow */
  const [searchParams, setSearchParams] = useSearchParams();
  const [outcome, setOutcome] = useState<AuthorizeOutcome | null>(null);
  /* Guards the forced discovery below, which costs one TikTok call per authorized advertiser */
  const handledCallback = useRef(false);

  useEffect(() => {
    const authz = searchParams.get("authz");
    if (!authz || handledCallback.current) return;
    handledCallback.current = true;

    if (authz === "ok" || authz === "mismatch" || authz === "error") {
      setOutcome({
        status: authz,
        advertiserId: searchParams.get("advertiser"),
        granted: Number(searchParams.get("granted") ?? "0") || 0,
        detail: searchParams.get("detail"),
      });
    }

    const next = new URLSearchParams(searchParams);
    for (const key of ["authz", "advertiser", "granted", "detail"]) next.delete(key);
    setSearchParams(next, { replace: true });

    /*
     * A new token only changes what discovery can see, and discovery is what writes
     * store_catalog
     */
    if (authz === "ok" || authz === "mismatch") void handleRefresh();
  }, [searchParams, setSearchParams, handleRefresh]);

  const query = useQuery({
    queryKey: ["gmv", "storeAuthorization"],
    // Always the cheap read. A forced refresh does not go through here, see below.
    queryFn: () => fetchStoreAuthorization(false),
    // Each load spends TikTok quota, so nothing here refetches without a click.
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  /* Fetched once on load for the cron expression */
  const [pendingSync, setPendingSync] = useState<Map<string, number>>(new Map());
  const syncStatus = useQuery({
    queryKey: ["gmv", "syncStatus"],
    queryFn: fetchSyncStatus,
    refetchInterval: 4000,
    // Keeps ticking while the tab is in the background
    refetchIntervalInBackground: true,
    enabled: pendingSync.size > 0,
    staleTime: 0,
    retry: 1,
  });

  /** Fetched once even when idle, so the cron hint has something to show. */
  const idleStatus = useQuery({
    queryKey: ["gmv", "syncStatus", "idle"],
    queryFn: fetchSyncStatus,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const cron = syncStatus.data?.cron ?? idleStatus.data?.cron;
  const runningTargets = useMemo(
    () => new Set(syncStatus.data?.runningTargets ?? []),
    [syncStatus.data],
  );

  /*
   * A target is only finished once a status response *newer than the click* says it is not
   * running
   */
  useEffect(() => {
    if (pendingSync.size === 0) return;
    const settledAt = syncStatus.dataUpdatedAt;
    if (!settledAt) return;

    const finished = [...pendingSync.entries()]
      .filter(([key, startedAt]) => settledAt > startedAt && !runningTargets.has(key))
      .map(([key]) => key);
    if (finished.length === 0) return;

    setPendingSync((current) => {
      const next = new Map(current);
      for (const key of finished) next.delete(key);
      return next;
    });
    // The sync has just rewritten lastError and the coverage counts for those rows.
    void queryClient.invalidateQueries({ queryKey: ["gmv", "storeAuthorization"] });
  }, [runningTargets, pendingSync, queryClient, syncStatus.dataUpdatedAt]);

  async function handleStoreSync(store: StoreAuthorizationRow): Promise<void> {
    const key = targetKey(store.advertiserId, store.storeId);
    // Recorded before the request resolves so the button disables on the click rather than a
    // round trip later
    const startedAt = Date.now();
    setPendingSync((current) => new Map(current).set(key, startedAt));
    try {
      await startStoreSync(store.advertiserId, store.storeId);
    } catch {
      setPendingSync((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    }
  }

  const stores = useMemo(() => query.data?.stores ?? [], [query.data]);
  const attentionCount = useMemo(
    () => stores.filter((s) => STATUS_STYLES[s.status].needsAttention).length,
    [stores],
  );

  const counts = useMemo(() => {
    const map = new Map<StoreAuthorizationStatus, number>();
    for (const store of stores) map.set(store.status, (map.get(store.status) ?? 0) + 1);
    return map;
  }, [stores]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return stores.filter((store) => {
      if (filter === "attention" && !STATUS_STYLES[store.status].needsAttention) return false;
      if (filter !== "all" && filter !== "attention" && store.status !== filter) return false;
      if (!needle) return true;
      return (
        store.storeName.toLowerCase().includes(needle) ||
        store.storeId.includes(needle) ||
        (store.storeCode ?? "").toLowerCase().includes(needle)
      );
    });
  }, [stores, filter, search]);

  const refreshing = isRefreshing || query.isFetching;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-2.5">
        <div>
          <h1 className="text-sm font-semibold">ร้านค้า</h1>
          <p className="text-xs text-muted-foreground">
            ร้านทั้งหมดที่มองเห็นผ่าน ad account ที่เชื่อมไว้ พร้อมสถานะการดึงข้อมูล
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative w-48">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาร้าน…"
              className="h-8 pl-8"
            />
          </div>

          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
            ตรวจสอบใหม่
          </Button>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-4">
        {/* shown even while the list is still loading */}
        {outcome ? (
          <AuthorizeOutcomeBanner
            outcome={outcome}
            storeName={
              stores.find((s) => s.exclusiveAdvertiserId === outcome.advertiserId)?.storeName
            }
            refreshing={refreshing}
            onDismiss={() => setOutcome(null)}
          />
        ) : null}

        {query.isLoading ? (
          <LoadingState label="กำลังตรวจสอบสถานะกับ TikTok…" />
        ) : query.error ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <>
            <FilterChips
              counts={counts}
              total={stores.length}
              attentionCount={attentionCount}
              active={filter}
              onChange={(next) => {
                setFilter(next);
                setExpanded(null);
              }}
            />

            {query.data?.advertiserErrors.length ? (
              <WarningList
                warnings={query.data.advertiserErrors.map(
                  (e) => `ดึงรายชื่อร้านของ advertiser ${e.advertiserId} ไม่ได้ - ${e.message}`,
                )}
              />
            ) : null}

            {stores.length === 0 ? (
              /*
               * Nothing in store_catalog at all, which is different from "the filter excluded
               * everything" and has to read differently
               */
              <EmptyState
                title="ยังไม่เคยดึงรายชื่อร้าน"
                description={
                  "รายชื่อร้านมาจากการ discovery ซึ่งทำงานอัตโนมัติทุกชั่วโมง - " +
                  "ถ้าเพิ่งติดตั้งหรือเพิ่งสร้างตาราง ให้กดดึงเดี๋ยวนี้ หรือรอรอบถัดไป" +
                  (cron ? ` (cron: ${cron})` : "")
                }
                action={
                  <Button size="sm" onClick={handleRefresh} disabled={refreshing}>
                    <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden />
                    {refreshing ? "กำลังดึงรายชื่อร้าน…" : "ดึงรายชื่อร้านตอนนี้"}
                  </Button>
                }
              />
            ) : visible.length === 0 ? (
              <EmptyState
                title={search ? "ไม่พบร้านที่ค้นหา" : "ไม่มีร้านในหมวดนี้"}
                description={
                  search
                    ? `ไม่มีร้านที่ตรงกับ "${search}"`
                    : filter === "attention"
                      ? "ทุกร้านที่มองเห็นดึงข้อมูลได้ปกติ"
                      : "ลองเลือกสถานะอื่น หรือกดทั้งหมด"
                }
                action={
                  filter !== "all" || search ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFilter("all");
                        setSearch("");
                      }}
                    >
                      ดูทั้งหมด ({stores.length})
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="overflow-hidden rounded-lg border border-border bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50 text-xs text-muted-foreground">
                      <th scope="col" className="w-full px-3 py-2 text-left font-medium">ร้านค้า</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium">สถานะ</th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">ข้อมูล</th>
                      <th
                        scope="col"
                        className="hidden whitespace-nowrap px-3 py-2 text-left font-medium lg:table-cell"
                      >
                        ช่วงข้อมูล
                      </th>
                      <th
                        scope="col"
                        className="hidden whitespace-nowrap px-3 py-2 text-left font-medium md:table-cell"
                      >
                        sync ล่าสุด
                      </th>
                      <th scope="col" className="w-8 px-2 py-2">
                        <span className="sr-only">รายละเอียด</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((store) => (
                      <StoreRow
                        key={store.storeId}
                        store={store}
                        isExpanded={expanded === store.storeId}
                        onToggle={() =>
                          setExpanded((current) => (current === store.storeId ? null : store.storeId))
                        }
                        isSyncing={
                          pendingSync.has(targetKey(store.advertiserId, store.storeId)) ||
                          runningTargets.has(targetKey(store.advertiserId, store.storeId))
                        }
                        onSync={() => void handleStoreSync(store)}
                        cron={cron}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              หน้านี้เห็นเฉพาะร้านที่อยู่ใต้ ad account ที่เชื่อม OAuth แล้วเท่านั้น - ร้านของบัญชีที่ยัง
              ไม่เคยเชื่อมจะไม่ปรากฏ เพราะไม่มี token ให้เรียก API
              {/* Only claim a check happened when one did */}
              {query.data && stores.length > 0 ? (
                <>
                  {" · รายชื่อร้าน ณ "}
                  {new Date(query.data.checkedAt).toLocaleString("th-TH")}
                  {` · ${query.data.advertisersChecked} ad account`}
                </>
              ) : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function FilterChips({
  counts,
  total,
  attentionCount,
  active,
  onChange,
}: {
  counts: Map<StoreAuthorizationStatus, number>;
  total: number;
  attentionCount: number;
  active: Filter;
  onChange: (filter: Filter) => void;
}) {
  if (total === 0) return null;

  const present = STATUS_ORDER.filter((status) => (counts.get(status) ?? 0) > 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip label="ทั้งหมด" count={total} active={active === "all"} onClick={() => onChange("all")} />
      {attentionCount > 0 ? (
        <Chip
          label="ต้องจัดการ"
          count={attentionCount}
          active={active === "attention"}
          onClick={() => onChange("attention")}
          tone="text-destructive"
        />
      ) : null}

      <span className="mx-1 h-4 w-px bg-border" aria-hidden />

      {present.map((status) => {
        const style = STATUS_STYLES[status];
        const Icon = style.icon;
        return (
          <Chip
            key={status}
            label={style.label}
            count={counts.get(status) ?? 0}
            active={active === status}
            onClick={() => onChange(status)}
            icon={<Icon className={cn("h-3 w-3", style.tint)} aria-hidden />}
          />
        );
      })}
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
  icon,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 font-medium text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {icon}
      <span className={cn(!active && tone)}>{label}</span>
      <span className="tabular font-medium text-foreground">{count}</span>
    </button>
  );
}

function StoreRow({
  store,
  isExpanded,
  onToggle,
  isSyncing,
  onSync,
  cron,
}: {
  store: StoreAuthorizationRow;
  isExpanded: boolean;
  onToggle: () => void;
  isSyncing: boolean;
  onSync: () => void;
  cron: string | undefined;
}) {
  const style = STATUS_STYLES[store.status];
  const Icon = style.icon;
  const wrongAccount = Boolean(
    store.exclusiveAdvertiserId && store.exclusiveAdvertiserId !== store.advertiserId,
  );

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer border-b border-border/60 hover:bg-accent/50",
          isExpanded && "bg-accent/40",
        )}
      >
        <td className="max-w-0 px-3 py-2">
          <span className="block truncate font-medium" title={store.storeName}>
            {store.storeName}
          </span>
          <span className="tabular block truncate font-mono text-xs text-muted-foreground">
            {store.storeId}
            {store.storeCode ? ` · ${store.storeCode}` : ""}
          </span>
        </td>

        <td className="whitespace-nowrap px-3 py-2">
          <span className="flex items-center gap-1.5">
            <Badge className={cn("whitespace-nowrap", style.badge)}>
              <Icon className="mr-1 h-3 w-3" aria-hidden />
              {style.label}
            </Badge>
            {isSyncing ? (
              <RefreshCcw className="h-3 w-3 animate-spin text-muted-foreground" aria-label="กำลัง sync" />
            ) : null}
          </span>
        </td>

        <td className="tabular whitespace-nowrap px-3 py-2 text-right">
          {store.rowCount > 0 ? (
            store.rowCount.toLocaleString("th-TH")
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </td>

        <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted-foreground lg:table-cell">
          {store.firstDate && store.lastDate
            ? `${formatDateLabel(store.firstDate)} – ${formatDateLabel(store.lastDate)}`
            : "-"}
        </td>

        <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-muted-foreground md:table-cell">
          {store.lastSyncedAt ? new Date(store.lastSyncedAt).toLocaleString("th-TH") : "ยังไม่เคย"}
        </td>

        <td className="px-2 py-2">
          <ChevronRight
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              isExpanded && "rotate-90",
            )}
            aria-hidden
          />
        </td>
      </tr>

      {isExpanded ? (
        <tr className="border-b border-border/60 bg-muted/30">
          <td colSpan={6} className="px-3 py-3">
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm text-foreground/80">{store.reason}</p>

                {store.syncEnabled !== null ? (
                  <Button variant="outline" size="sm" onClick={onSync} disabled={isSyncing}>
                    <RefreshCcw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} aria-hidden />
                    {isSyncing ? "กำลัง sync…" : "sync ร้านนี้ใหม่"}
                  </Button>
                ) : null}
              </div>

              {SELF_HEALING.has(store.status) && !isSyncing ? (
                <p className="text-xs text-muted-foreground">
                  ระบบจะลองใหม่เองในรอบถัดไป{cron ? ` (cron: ${cron})` : ""} - กดปุ่มด้านบนได้ถ้าไม่อยากรอ
                </p>
              ) : null}

              {store.status === "notAuthorized" ? (
                <AuthorizeAction store={store} />
              ) : store.action ? (
                <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="text-xs">
                    <span className="font-medium">ต้องทำ: </span>
                    {store.action}
                  </p>
                </div>
              ) : null}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs lg:grid-cols-4">
                <Detail label="Ad account ที่ใช้ดู" value={store.advertiserId} mono />
                <Detail
                  label="Ad account ที่มีสิทธิ์"
                  value={
                    store.exclusiveAdvertiserId
                      ? `${store.exclusiveAdvertiserName ?? "?"} (${store.exclusiveAdvertiserId})`
                      : "-"
                  }
                  highlight={wrongAccount}
                />
                <Detail label="Business Center" value={store.bcName ?? store.storeAuthorizedBcId ?? "-"} />
                <Detail
                  label="GMV Max"
                  value={store.isGmvMaxAvailable ? "เปิดใช้งาน" : "ไม่ได้เปิด"}
                  highlight={!store.isGmvMaxAvailable}
                />
              </dl>

              {store.lastError ? (
                <p className="break-words rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-foreground/70">
                  {store.lastError}
                </p>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** The result of a consent round trip, shown once on return from TikTok */
function AuthorizeOutcomeBanner({
  outcome,
  storeName,
  refreshing,
  onDismiss,
}: {
  outcome: AuthorizeOutcome;
  storeName: string | undefined;
  refreshing: boolean;
  onDismiss: () => void;
}) {
  const tone =
    outcome.status === "ok"
      ? { box: "border-success/40 bg-success/10", icon: CheckCircle2, text: "text-success" }
      : outcome.status === "mismatch"
        ? { box: "border-warning/40 bg-warning/10", icon: AlertTriangle, text: "text-warning" }
        : { box: "border-destructive/40 bg-destructive/10", icon: XCircle, text: "text-destructive" };
  const Icon = tone.icon;

  const title =
    outcome.status === "ok"
      ? "เชื่อม ad account สำเร็จ"
      : outcome.status === "mismatch"
        ? "TikTok ยืนยันแล้ว แต่ได้คนละบัญชี"
        : "เชื่อมไม่สำเร็จ";

  const body =
    outcome.status === "ok"
      ? `ได้สิทธิ์มา ${outcome.granted} ad account` +
        (storeName ? ` - ${storeName} จะเปลี่ยนสถานะเมื่อดึงรายชื่อร้านรอบใหม่เสร็จ` : "") +
        (refreshing ? " · กำลังดึงอยู่…" : "")
      : outcome.status === "mismatch"
        ? `ลิงก์นี้ขอสิทธิ์ของ ad account ${outcome.advertiserId ?? "?"} แต่บัญชีที่กดยืนยันมา ` +
          `${outcome.granted} รายการไม่มีตัวนั้นอยู่ด้วย - token ที่ได้เก็บไว้แล้ว ไม่เสียเปล่า ` +
          `แต่ถ้าจะแก้ร้านนี้ต้องสร้างลิงก์ใหม่แล้วเลือกบัญชีให้ตรง` +
          // The callback names only the account that was asked for, never the one that was
          // granted
          (refreshing ? " · กำลังดึงรายชื่อร้านใหม่ เพื่อดูว่าได้บัญชีไหนมา…" : " · ดูจากตารางด้านล่างว่าได้บัญชีไหนมา")
        : `${outcome.detail ?? "ไม่ทราบสาเหตุ"} - ลิงก์ใช้ได้ครั้งเดียวและหมดอายุใน 30 นาที ` +
          `ถ้าเกินนั้นให้สร้างใหม่`;

  return (
    <div className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5", tone.box)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.text)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-foreground/75">{body}</p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background/60 hover:text-foreground"
        aria-label="ปิด"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** Starts the consent flow for the one ad account that holds GMV Max rights here */
function AuthorizeAction({ store }: { store: StoreAuthorizationRow }) {
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const target = store.exclusiveAdvertiserId;
  if (!target) return null;

  async function mint(): Promise<{ url: string; expiresAt: string } | null> {
    setBusy(true);
    setError(null);
    try {
      const next = await createAuthorizeLink(target as string, store.storeId);
      setLink(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างลิงก์ไม่สำเร็จ");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(): Promise<void> {
    /* A full-page navigation, not a new tab */
    const next = await mint();
    if (next) window.location.href = next.url;
  }

  async function handleCopy(): Promise<void> {
    const next = link ?? (await mint());
    if (!next) return;
    try {
      await navigator.clipboard.writeText(next.url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused outright
      setError("คัดลอกอัตโนมัติไม่ได้ - เลือกลิงก์ด้านล่างแล้วคัดลอกเอง");
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-destructive/30 bg-background px-3 py-2.5">
      <div>
        <p className="text-xs font-medium">ต้อง authorize ad account นี้ก่อน</p>
        <p className="tabular mt-0.5 font-mono text-xs text-muted-foreground">
          {store.exclusiveAdvertiserName ?? "?"} ({target})
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        คนที่กดยืนยันต้องล็อกอิน TikTok ด้วยบัญชีที่มองเห็น ad account นี้ - ปุ่มซ้ายจะพาออกจาก
        หน้านี้ไป TikTok แล้วพากลับมาเอง ถ้าเป็นของลูกค้าให้คัดลอกลิงก์ส่งไปให้เขากดแทน
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void handleOpen()} disabled={busy}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          {busy && !link ? "กำลังสร้างลิงก์…" : "ไปหน้า authorize"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handleCopy()} disabled={busy}>
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
        </Button>
      </div>

      {link ? (
        <div className="space-y-1">
          <input
            readOnly
            value={link.url}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground"
            aria-label="ลิงก์ authorize"
          />
          <p className="text-[11px] text-muted-foreground">
            ใช้ได้ครั้งเดียว · หมดอายุ {new Date(link.expiresAt).toLocaleTimeString("th-TH", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      ) : null}

      {/* TikTok cannot pre-select the account, so remind the user which one to pick */}
      <p className="text-[11px] text-warning">
        หน้า TikTok จะให้เลือกบัญชีเอง - ต้องติ๊ก {store.exclusiveAdvertiserName ?? target} ให้ถูก
        ไม่งั้นร้านนี้จะยังดึงข้อมูลไม่ได้เหมือนเดิม
      </p>

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
  highlight = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn("truncate", mono && "tabular font-mono", highlight && "font-medium text-destructive")}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}
