import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CirclePause, CirclePlay, LockKeyhole, RefreshCw, Target } from "lucide-react";
import { confirmCampaignControl, fetchCampaignControlStatus, isConfirmableCampaignPreview, previewCampaignControl, readCampaignOperation,
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
export function CampaignControlPanel({ userId, actionsEnabled = true, syncedCampaignId, onVerified }: {
  userId: number; actionsEnabled?: boolean; syncedCampaignId?: string | null; onVerified?: (action: CampaignControlAction) => void;
}) {
  const heading = useId();
  const input = useId();
  const [action, setAction] = useState<CampaignControlAction | null>(null);
  const [target, setTarget] = useState("");
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
    queryKey: ["automation", "campaign-control", userId],
    queryFn: ({ signal }) => fetchCampaignControlStatus(signal),
    gcTime: 0, retry: false, staleTime: 0, refetchInterval: (query) => blockedRequest(query.state.error) ? false : 30_000,
  });
  const data = result.isSuccess ? result.data : null;
  const campaign = data?.campaign ?? null;
  const supports = (value: CampaignControlAction | null) => value === "SET_ROI" ? data?.capabilities.setRoi :
    value === "PAUSE" ? data?.capabilities.pause : value === "RESUME" ? data?.capabilities.resume : false;
  const available = supports(action);
  const matchedSync = syncedCampaignId === undefined || (syncedCampaignId === null ? campaign?.operationStatus === "DISABLE" : campaign?.campaignId === syncedCampaignId);
  const canReview = actionsEnabled && matchedSync && !pendingId && !pending;
  const canConfirm = (value: CampaignActionPreview) => canReview && acknowledged && data?.mode === "live" && supports(value.action) &&
    isConfirmableCampaignPreview(value) && campaign?.campaignId === value.campaignId &&
    campaign.operationStatus === value.before.status && campaign.roiTargetTenths === value.before.roiTenths &&
    Date.now() - Date.parse(campaign.observedAt) >= -5_000 && Date.now() - Date.parse(campaign.observedAt) <= 45_000;

  function choose(next: CampaignControlAction) {
    if (!canReview || busy.current) return;
    setNotice(null); setOutcome(null); setPreview(null); setAcknowledged(false); setAction(next); setTarget("");
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !campaign || !action || !available || !canReview || busy.current) return;
    const age = Date.now() - Date.parse(campaign.observedAt);
    if (age < -5_000 || age > 45_000) { setNotice("ข้อมูลหมดอายุ กรุณาอัปเดตสถานะแคมเปญก่อน"); return; }
    const requested = action === "SET_ROI" ? parseCampaignRoiTenths(target) : null;
    if (action === "SET_ROI" && (requested === null || requested === campaign.roiTargetTenths)) {
      setNotice("กรอก ROI Target ใหม่ 0.1–999.9 โดยใช้ทศนิยมไม่เกิน 1 ตำแหน่ง"); return;
    }
    busy.current = true; setPending(true); setNotice(null); setPreview(null); setAcknowledged(false);
    try {
      const next = await previewCampaignControl({ campaignId: campaign.campaignId, action, expectedStatus: campaign.operationStatus,
        expectedRoiTenths: campaign.roiTargetTenths, ...(requested !== null ? { targetRoiTenths: requested } : {}) });
      setPreview(next); setAction(null);
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409 ? "แคมเปญหรือสิทธิ์เปลี่ยนระหว่างตรวจ กรุณาอัปเดตสถานะก่อน"
        : "ยังตรวจรายการไม่ได้ ไม่มีคำสั่งแก้ไขถูกส่งไป TikTok");
    } finally { busy.current = false; setPending(false); }
  }

  function applyOutcome(value: CampaignOperation) {
    const terminal = value.status === "APPLIED_VERIFIED" || value.status === "NOT_SENT";
    if (terminal) storePendingOperation(userId, null);
    if (!mounted.current) return;
    setOutcome(value);
    if (terminal) {
      setPendingId(null);
      if (value.status === "APPLIED_VERIFIED") { void result.refetch(); onVerified?.(value.action); }
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

  return <section aria-labelledby={heading} className="space-y-2 rounded-lg border border-border bg-card p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 id={heading} className="text-sm font-semibold">จัดการแคมเปญ Ppan</h4>
      {!blockedRequest(result.error) && <Button type="button" size="sm" variant="ghost" className="min-h-9" disabled={result.isFetching || pending}
        onClick={() => { setAction(null); setPreview(null); setNotice(null); void result.refetch(); }}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> อัปเดต
      </Button>}
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
        {data.capabilities.pause && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={!canReview} onClick={() => choose("PAUSE")}><CirclePause className="h-3.5 w-3.5" aria-hidden /> พัก</Button>}
        {data.capabilities.resume && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={!canReview} onClick={() => choose("RESUME")}><CirclePlay className="h-3.5 w-3.5" aria-hidden /> เปิดแคมเปญเดิมอีกครั้ง</Button>}
      </div>
      {action && <form className="space-y-2 rounded-md border border-border p-2.5 text-sm" onSubmit={(event) => void review(event)}>
        {action === "SET_ROI" ? <label className="flex flex-wrap items-center gap-2" htmlFor={input}>ROI Target ใหม่
          <Input id={input} className="w-24" type="text" inputMode="decimal" maxLength={5} value={target} disabled={pending} onChange={(event) => setTarget(event.target.value)} />
        </label> : <p>ตรวจเงื่อนไข{action === "PAUSE" ? "พัก" : "เปิดใหม่"}สำหรับแคมเปญนี้</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button type="submit" size="sm" disabled={!canReview || !available}>{pending ? "กำลังตรวจ…" : "ตรวจรายการ"}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setAction(null); setNotice(null); }}>ยกเลิก</Button>
        </div>
      </form>}
      {preview && <div className="space-y-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
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
      </div>}
    </>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {outcome && <p role="status" className="text-sm font-medium">{outcomeText[outcome.status]}</p>}
    {pendingId && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="break-all">รายการ: {pendingId}</span>
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={pending} onClick={() => void checkPending()}>ตรวจผลรายการเดิม</Button>
    </div>}
  </section>;
}
