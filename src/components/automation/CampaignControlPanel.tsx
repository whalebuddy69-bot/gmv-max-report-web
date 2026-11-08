import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CirclePause, CirclePlay, LockKeyhole, RefreshCw, Target } from "lucide-react";
import { confirmCampaignControl, fetchCampaignControlStatus, fetchScopedCampaignControlStatus, isConfirmableCampaignPreview, previewCampaignControl, readCampaignOperation,
  type CampaignActionPreview, type CampaignControlAction, type CampaignOperation } from "@/api/automationCampaign";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const roi = (tenths: number) => (tenths / 10).toLocaleString("th-TH", { maximumFractionDigits: 1 });
const displayStatus = (status: "ENABLE" | "DISABLE") => status === "ENABLE" ? "เปิดใช้งาน" : "พักอยู่";
const reasons = new Map([
  ["MODE_DISABLED", "ยังไม่ได้เปิดการจัดการแคมเปญ"], ["NO_EXACT_CAMPAIGN", "ยังไม่พบแคมเปญที่ยืนยันได้สำหรับบัญชีนี้"],
  ["MULTIPLE_ACTIVE_CAMPAIGNS", "พบหลายแคมเปญที่เปิดอยู่ ระบบจะไม่เลือกให้เอง"], ["CAMPAIGN_UNAVAILABLE", "TikTok ยังไม่ส่งข้อมูลแคมเปญที่ยืนยันได้"],
  ["AUTO_ACTIVE", "หยุด Auto ของบัญชีนี้ก่อนเปลี่ยนการตั้งค่าแคมเปญ"], ["WRITE_LOCKED", "มีรายการที่ต้องตรวจผลก่อนทำรายการใหม่"],
]);
const blockedRequest = (error: unknown) => error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);
const campaignOpKey = (userId: number) => `gmv-max-ppan-campaign-operation-v1:${userId}`;
const opaqueOperationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function loadPendingOperation(userId: number) {
  try { const id = sessionStorage.getItem(campaignOpKey(userId)); return id && opaqueOperationId.test(id) ? id : null; } catch { return null; }
}
export function hasPendingCampaignOperation(userId: number) {
  return loadPendingOperation(userId) !== null;
}
function storePendingOperation(userId: number, operationId: string | null) {
  try {
    if (operationId) sessionStorage.setItem(campaignOpKey(userId), operationId);
    else sessionStorage.removeItem(campaignOpKey(userId));
  } catch { /* Browser storage may be disabled; server still prevents a replay. */ }
}
const outcomeText: Record<CampaignOperation["status"], string> = {
  APPLIED_VERIFIED: "ยืนยันผลจาก TikTok แล้ว", NOT_SENT: "ไม่ได้ส่งคำสั่งไป TikTok", PREPARED: "ยังไม่พบผลของคำยืนยัน",
  PROCESSING: "กำลังตรวจผลจาก TikTok", OUTCOME_UNKNOWN: "ยังยืนยันผลไม่ได้ · อย่าส่งซ้ำ",
};

export function parseCampaignRoiTenths(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d))?$/.exec(text.trim());
  if (!match) return null;
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? "0");
  return tenths > 0 && tenths <= 9999 ? tenths : null;
}

/** Confirmation only for a live, explicitly reviewed Ppan operation. */
export function CampaignControlPanel({ userId, actionsEnabled = true, syncedCampaignId, onVerified, layout = "default", fallbackRoi = null, selectedCampaignId, lifecycleAction }: {
  userId: number; actionsEnabled?: boolean; syncedCampaignId?: string | null; onVerified?: (action: CampaignControlAction) => void;
  layout?: "default" | "roi-field" | "lifecycle" | "recovery"; fallbackRoi?: number | null; selectedCampaignId?: string;
  lifecycleAction?: "PAUSE" | "RESUME";
}) {
  const heading = useId();
  const input = useId();
  const description = useId();
  const isRoiField = layout === "roi-field";
  const isLifecycle = layout === "lifecycle";
  const isRecovery = layout === "recovery";
  const isTargeted = isRoiField || isLifecycle;
  const canReadDetails = !isRecovery && (isLifecycle ? actionsEnabled && selectedCampaignId !== undefined && lifecycleAction !== undefined
    : !isRoiField || (actionsEnabled && selectedCampaignId !== undefined && syncedCampaignId === selectedCampaignId));
  const [action, setAction] = useState<CampaignControlAction | null>(null);
  const [target, setTarget] = useState("");
  const [roiDraft, setRoiDraft] = useState<{ campaignId: string; value: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<CampaignActionPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pendingId, setPendingId] = useState(() => loadPendingOperation(userId));
  const [outcome, setOutcome] = useState<CampaignOperation | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const result = useQuery({
    queryKey: isRecovery ? ["automation", "campaign-control-recovery", userId]
      : isTargeted ? ["automation", "campaign-control", userId, selectedCampaignId] : ["automation", "campaign-control", userId],
    queryFn: ({ signal }) => isTargeted && selectedCampaignId !== undefined ? fetchScopedCampaignControlStatus(selectedCampaignId, signal) : fetchCampaignControlStatus(signal),
    enabled: canReadDetails,
    gcTime: 0, retry: false, staleTime: 0, refetchInterval: (query) => blockedRequest(query.state.error) ? false : 30_000,
  });
  const data = canReadDetails && result.isSuccess ? result.data : null;
  const campaign = data?.campaign ?? null;
  const effectiveMode = (value: CampaignControlAction) => {
    const key = value === "SET_ROI" ? "setRoi" : value === "PAUSE" ? "pause" : "resume";
    return data?.actionModes?.[key] ?? (isTargeted ? undefined : data?.mode);
  };
  const roiMode = effectiveMode("SET_ROI");
  const supports = (value: CampaignControlAction | null) => !(isLifecycle && value !== lifecycleAction) && (value === "SET_ROI" ? data?.capabilities.setRoi :
    value === "PAUSE" ? data?.capabilities.pause : value === "RESUME" ? data?.capabilities.resume : false);
  const available = supports(action);
  const matchedSync = isLifecycle ? campaign?.campaignId === selectedCampaignId && lifecycleAction !== undefined &&
    campaign?.operationStatus === (lifecycleAction === "PAUSE" ? "ENABLE" : "DISABLE")
    : syncedCampaignId === undefined || (syncedCampaignId === null ? campaign?.operationStatus === "DISABLE" : campaign?.campaignId === syncedCampaignId);
  const canReview = actionsEnabled && matchedSync && !pendingId && !pending;
  const exactActiveCampaign = campaign?.operationStatus === "ENABLE" && campaign.campaignId === selectedCampaignId && campaign.campaignId === syncedCampaignId ? campaign : null;
  const canReviewRoiField = canReview && exactActiveCampaign !== null && supports("SET_ROI") === true && (roiMode === "live" || roiMode === "dry-run");
  const exactRoiDraft = exactActiveCampaign && roiDraft?.campaignId === exactActiveCampaign.campaignId ? roiDraft.value : null;
  const existingRoiValue = exactActiveCampaign ? String(exactActiveCampaign.roiTargetTenths / 10)
    : fallbackRoi !== null && Number.isFinite(fallbackRoi) && fallbackRoi >= 0 ? String(fallbackRoi) : "";
  const requestedRoi = exactRoiDraft === null ? null : parseCampaignRoiTenths(exactRoiDraft);
  const canConfirm = (value: CampaignActionPreview) => canReview && acknowledged && effectiveMode(value.action) === "live" && supports(value.action) &&
    (!isRoiField || value.action !== "SET_ROI" || canReviewRoiField) &&
    isConfirmableCampaignPreview(value) && campaign?.campaignId === value.campaignId &&
    campaign.operationStatus === value.before.status && campaign.roiTargetTenths === value.before.roiTenths &&
    Date.now() - Date.parse(campaign.observedAt) >= -5_000 && Date.now() - Date.parse(campaign.observedAt) <= 45_000;

  function choose(next: CampaignControlAction) {
    if (!canReview || busy.current) return;
    setNotice(null); setOutcome(null); setPreview(null); setAcknowledged(false); setAction(next); setTarget("");
  }

  function changeRoiDraft(value: string) {
    if (!canReviewRoiField || !exactActiveCampaign || busy.current) return;
    setRoiDraft({ campaignId: exactActiveCampaign.campaignId, value });
    setAction(null); setNotice(null); setOutcome(null); setPreview(null); setAcknowledged(false);
  }

  async function review(event: FormEvent<HTMLFormElement>, forcedAction?: CampaignControlAction) {
    event.preventDefault();
    const nextAction = forcedAction ?? action;
    if (!data || !campaign || !nextAction || !supports(nextAction) || !canReview || busy.current ||
      (isLifecycle && effectiveMode(nextAction) !== "dry-run" && effectiveMode(nextAction) !== "live") ||
      (isRoiField && nextAction === "SET_ROI" && (!canReviewRoiField || preview?.action === "SET_ROI"))) return;
    const age = Date.now() - Date.parse(campaign.observedAt);
    if (age < -5_000 || age > 45_000) { setNotice("ข้อมูลหมดอายุ กรุณาอัปเดตสถานะแคมเปญก่อน"); return; }
    const requested = nextAction === "SET_ROI" ? (isRoiField ? requestedRoi : parseCampaignRoiTenths(target)) : null;
    if (nextAction === "SET_ROI" && (requested === null || requested === campaign.roiTargetTenths)) {
      setNotice("กรอก ROI Target ใหม่ 0.1–999.9 โดยใช้ทศนิยมไม่เกิน 1 ตำแหน่ง"); return;
    }
    busy.current = true; setPending(true); setNotice(null); setPreview(null); setAcknowledged(false);
    try {
      const next = await previewCampaignControl({ campaignId: campaign.campaignId, action: nextAction, expectedStatus: campaign.operationStatus,
        expectedRoiTenths: campaign.roiTargetTenths, ...(requested !== null ? { targetRoiTenths: requested } : {}) });
      if (next.mode !== effectiveMode(nextAction)) { setNotice("สิทธิ์เปลี่ยนระหว่างเตรียมรายการ กรุณาอัปเดตสถานะก่อน"); return; }
      setPreview(next); setAction(null);
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409 ? "แคมเปญหรือสิทธิ์เปลี่ยนระหว่างตรวจ กรุณาอัปเดตสถานะก่อน"
        : "ยังตรวจรายการไม่ได้ ไม่มีคำสั่งแก้ไขถูกส่งไป TikTok");
    } finally { busy.current = false; setPending(false); }
  }

  function applyOutcome(value: CampaignOperation) {
    const terminal = value.status === "APPLIED_VERIFIED" || value.status === "NOT_SENT";
    // A user who left while waiting should still be able to see the result from the list.
    if (!mounted.current) return;
    setOutcome(value);
    if (terminal) {
      storePendingOperation(userId, null);
      setPendingId(null);
      if (value.status === "APPLIED_VERIFIED") {
        if (value.action === "SET_ROI") setRoiDraft(null);
        if (canReadDetails) void result.refetch();
        onVerified?.(value.action);
      }
    }
  }

  async function confirm() {
    if (!preview || !isConfirmableCampaignPreview(preview) || !canConfirm(preview) || busy.current) return;
    const reviewed = preview;
    busy.current = true;
    storePendingOperation(userId, reviewed.operationId);
    setPendingId(reviewed.operationId); setPending(true); setPreview(null); setAcknowledged(false); setNotice(null);
    try { applyOutcome(await confirmCampaignControl(reviewed)); }
    catch { if (mounted.current) setNotice("ยังยืนยันผลไม่ได้ กรุณากดตรวจผลรายการเดิม ไม่ต้องส่งคำสั่งซ้ำ"); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }

  async function checkPending() {
    if (!pendingId || busy.current) return;
    busy.current = true; setPending(true); setNotice(null);
    try { applyOutcome(await readCampaignOperation(pendingId)); }
    catch { if (mounted.current) setNotice("ยังอ่านผลรายการเดิมไม่ได้ กรุณาลองตรวจผลอีกครั้ง"); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }

  const reviewForm = action && <form className="space-y-2 rounded-md border border-border p-2.5 text-sm" onSubmit={(event) => void review(event)}>
    {action === "SET_ROI" ? <label className="flex flex-wrap items-center gap-2" htmlFor={input}>ROI Target ใหม่
      <Input id={input} className="w-24" type="text" inputMode="decimal" maxLength={5} value={target} disabled={pending} onChange={(event) => setTarget(event.target.value)} />
    </label> : <p>ตรวจเงื่อนไข{action === "PAUSE" ? "พัก" : "เปิดใหม่"}สำหรับแคมเปญนี้</p>}
    <div className="flex flex-wrap gap-1.5">
      <Button type="submit" size="sm" disabled={!canReview || !available}>{pending ? "กำลังตรวจ…" : "ตรวจรายการ"}</Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setAction(null); setNotice(null); }}>ยกเลิก</Button>
    </div>
  </form>;
  const reviewResult = preview && <div className="space-y-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
    <p role="status" className="font-medium">ตรวจรายการผ่าน · ยังไม่ได้ส่งคำสั่งไป TikTok</p>
    <p className="mt-1 text-muted-foreground">{preview.action === "SET_ROI" ? `ROI Target ${roi(preview.before.roiTenths)}× → ${roi(preview.after.roiTenths)}×`
      : `${displayStatus(preview.before.status)} → ${displayStatus(preview.after.status)}`}</p>
    {preview.mode === "live" && <>
      <p className="break-all text-xs text-muted-foreground">Campaign ID: {preview.campaignId}</p>
      <label className="flex min-h-10 items-center gap-2">
        <input className="h-4 w-4" type="checkbox" checked={acknowledged} disabled={!actionsEnabled} onChange={event => setAcknowledged(event.target.checked)} />
        ยืนยันว่าต้องการส่งคำสั่งนี้จริง
      </label>
      <Button className="min-h-11 w-full sm:w-auto" disabled={!canConfirm(preview)} onClick={() => void confirm()}>
        {preview.action === "RESUME" ? "ยืนยันเปิดแคมเปญจริง" : "ยืนยันส่งคำสั่งจริง"}
      </Button>
    </>}
  </div>;
  const lifecycleActions = <>
    {data?.capabilities.pause && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={!canReview} onClick={() => choose("PAUSE")}><CirclePause className="h-3.5 w-3.5" aria-hidden /> พัก</Button>}
    {data?.capabilities.resume && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={!canReview} onClick={() => choose("RESUME")}><CirclePlay className="h-3.5 w-3.5" aria-hidden /> เปิดแคมเปญเดิมอีกครั้ง</Button>}
  </>;
  const activity = <>
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {outcome && <p role="status" className="break-words text-sm font-medium">{outcomeText[outcome.status]}
      {selectedCampaignId && outcome.campaignId !== selectedCampaignId && <span className="block break-all text-xs font-normal text-muted-foreground">ผลรายการเดิม · Campaign ID: {outcome.campaignId}</span>}
    </p>}
    {pendingId && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="break-all">รายการ: {pendingId}</span>
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={pending} onClick={() => void checkPending()}>ตรวจผลรายการเดิม</Button>
    </div>}
  </>;
  const refresh = <Button type="button" size="sm" variant="ghost" className="min-h-9" disabled={result.isFetching || pending}
    onClick={() => { setAction(null); setPreview(null); setAcknowledged(false); setNotice(null); setRoiDraft(null); void result.refetch(); }}>
    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> อัปเดต
  </Button>;

  if (isRecovery) return <section aria-labelledby={heading} className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-3 sm:p-4">
    <h3 id={heading} className="text-sm font-semibold">ผลคำสั่งแคมเปญเดิม</h3>
    {pendingId || outcome || notice ? activity : <p className="text-xs text-muted-foreground">ไม่พบรายการค้างในเบราว์เซอร์นี้</p>}
  </section>;

  if (isLifecycle) {
    const label = lifecycleAction === "PAUSE" ? "ปิดแคมเปญ" : "เปิดแคมเปญเดิม";
    const mode = lifecycleAction && effectiveMode(lifecycleAction);
    return <section aria-labelledby={heading} className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={heading} className="text-sm font-semibold">{label}</h3>
        {canReadDetails && !blockedRequest(result.error) && refresh}
      </div>
      {selectedCampaignId && <p className="break-all text-xs text-muted-foreground">Campaign ID: {selectedCampaignId}</p>}
      {!canReadDetails ? <p className="text-xs text-muted-foreground">ยังไม่ยืนยันสิทธิ์ของแคมเปญนี้</p>
        : result.isPending ? <p role="status" className="text-xs text-muted-foreground">กำลังอ่านสถานะแคมเปญนี้…</p>
          : result.isError ? <p className="text-xs text-muted-foreground">ยังยืนยันสิทธิ์หรือสถานะล่าสุดไม่ได้</p>
            : !matchedSync || !lifecycleAction || !supports(lifecycleAction) || (mode !== "live" && mode !== "dry-run") ? <p className="text-xs text-muted-foreground">
              {data?.blocker ? reasons.get(data.blocker) ?? "ยังไม่ผ่านเงื่อนไขการเปลี่ยนสถานะ" : "สถานะเปลี่ยนหรือบัญชีนี้ยังไม่รองรับคำสั่งนี้"}
            </p> : <>
              {mode === "dry-run" && <p className="text-xs text-muted-foreground">ทดลองเท่านั้น · ยังเปลี่ยนสถานะจริงไม่ได้</p>}
              {!preview && !pendingId && <form onSubmit={(event) => void review(event, lifecycleAction)}>
                <Button type="submit" variant="outline" size="sm" className="min-h-10" disabled={!canReview}>{pending ? "กำลังเตรียม…" : mode === "dry-run" ? "ดูตัวอย่าง" : "เตรียมรายการยืนยัน"}</Button>
              </form>}
              {preview && reviewResult}
            </>}
      {activity}
    </section>;
  }

  if (isRoiField) return <section aria-labelledby={heading} className="min-w-0 space-y-2.5 rounded-lg border border-border bg-card p-3.5 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={heading} className="text-base font-semibold"><label htmlFor={input}>LIVE ROI Target</label></h3>
      <div className="flex items-center gap-2">
        {roiMode === "dry-run" && <Badge variant="outline">โหมดทดลอง · ไม่บันทึกจริง</Badge>}
        {canReadDetails && !blockedRequest(result.error) && refresh}
      </div>
    </div>
    <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => void review(event, "SET_ROI")}>
      <div className="relative w-full min-w-0 flex-1 basis-36 sm:max-w-xs">
        <Input id={input} className="min-h-11 pr-9 tabular-nums read-only:bg-muted/30" type="text" inputMode="decimal" maxLength={5}
          value={exactRoiDraft ?? existingRoiValue} placeholder="—" readOnly={!canReviewRoiField} aria-describedby={description}
          aria-invalid={canReviewRoiField && exactRoiDraft !== null && exactRoiDraft !== "" && requestedRoi === null ? true : undefined}
          onChange={(event) => changeRoiDraft(event.target.value)} />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">×</span>
      </div>
      {canReadDetails && exactRoiDraft !== null && exactRoiDraft !== existingRoiValue && <Button type="submit" variant="outline" size="sm" className="min-h-11 shrink-0"
        disabled={!canReviewRoiField || requestedRoi === null || requestedRoi === exactActiveCampaign?.roiTargetTenths || preview?.action === "SET_ROI"}>{pending ? "กำลังเตรียม…" : roiMode === "dry-run" ? "ดูตัวอย่าง" : "บันทึก ROI Target"}</Button>}
    </form>
    <p id={description} className="text-xs text-muted-foreground">
      เป้าหมายยอดขายต่อค่าโฆษณา (เท่า) · {!canReadDetails ? "Sync ก่อนแก้ไข"
        : result.isPending ? "กำลังอ่านสถานะแคมเปญ…"
          : result.isError ? "ยังยืนยันสิทธิ์หรือสถานะแคมเปญไม่ได้"
            : !matchedSync ? "แคมเปญที่อ่านได้ไม่ตรงกับรอบ Sync"
              : data?.blocker ? reasons.get(data.blocker) ?? "ยังยืนยันเงื่อนไขให้จัดการแคมเปญไม่ได้"
                : !exactActiveCampaign || !data?.capabilities.setRoi || (roiMode !== "live" && roiMode !== "dry-run") ? "ยังแก้ไขไม่ได้สำหรับแคมเปญนี้"
                  : exactRoiDraft !== null && requestedRoi === null ? "กรอก 0.1–999.9 โดยใช้ทศนิยมไม่เกิน 1 ตำแหน่ง"
                    : roiMode === "dry-run" ? "ดูตัวอย่างได้ แต่ยังไม่ส่งคำสั่งไป TikTok"
                      : "ตรวจรายละเอียดก่อนยืนยันทุกคำสั่ง"}
    </p>
    {preview?.action === "SET_ROI" && reviewResult}
    {activity}
  </section>;

  return <section aria-labelledby={heading} className="space-y-2 rounded-lg border border-border bg-card p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 id={heading} className="text-sm font-semibold">จัดการแคมเปญ Ppan</h4>
      {!blockedRequest(result.error) && refresh}
    </div>
    {result.isPending ? <p className="text-xs text-muted-foreground">กำลังอ่านสถานะแคมเปญ…</p> : result.isError ? (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" aria-hidden />
        {blockedRequest(result.error) ? "บัญชีนี้ยังไม่มีสิทธิ์หรือยังไม่เปิดการจัดการแคมเปญ" : "ยังอ่านสถานะแคมเปญไม่ได้"}
      </p>
    ) : data && <>
      {data.mode !== "disabled" && <Badge variant="outline">{data.mode === "dry-run" ? "ตรวจเงื่อนไขเท่านั้น · ยังไม่แก้ TikTok" : "ตรวจรายละเอียดก่อนยืนยันทุกคำสั่ง"}</Badge>}
      {campaign && <p className="break-words text-sm">{campaign.campaignName || "แคมเปญ Ppan"} <span className="text-muted-foreground">· {displayStatus(campaign.operationStatus)} · ROI Target {roi(campaign.roiTargetTenths)}×</span></p>}
      {data.blocker && <p className="text-xs text-muted-foreground">{reasons.get(data.blocker) ?? "ยังยืนยันเงื่อนไขให้จัดการแคมเปญไม่ได้"}</p>}
      {!actionsEnabled && <p className="text-xs text-muted-foreground">กด Sync บัญชีที่เลือกก่อนจัดการแคมเปญ</p>}
      {actionsEnabled && !matchedSync && campaign && <p className="text-xs text-muted-foreground">แคมเปญที่อ่านได้ไม่ตรงกับรอบ Sync กรุณากด Sync อีกครั้ง</p>}
      <div className="flex flex-wrap gap-1.5">
        {data.capabilities.setRoi && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={!canReview} onClick={() => choose("SET_ROI")}><Target className="h-3.5 w-3.5" aria-hidden /> แก้ ROI Target</Button>}
        {lifecycleActions}
      </div>
      {reviewForm}
      {reviewResult}
    </>}
    {activity}
  </section>;
}
