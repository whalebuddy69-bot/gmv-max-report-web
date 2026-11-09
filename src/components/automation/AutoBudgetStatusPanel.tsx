import { useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { AutomationDisclosureBody, AutomationDisclosureRow, AutomationSwitchTrack, automationDisclosureFrame } from "./AutomationDisclosure";
import { armBudgetAuto, armBudgetAutoContinuous, fetchBudgetAutoOverviewStatus, fetchBudgetAutoStatus, requiresVerifiedRoomSpendTrendAuto,
  stopBudgetAuto, stopBudgetAutoContinuous, supportsAutoWaitingForLive, supportsContinuousAutoEvidence,
  VERIFIED_ROOM_SPEND_TREND, WAITING_FOR_LIVE,
  type BudgetAutoArmInput, type BudgetAutoSpendTrendArmInput, type BudgetAutoVerifiedContinuousArmInput, type BudgetAutoVerifiedRoomSpendTrendArmInput, type BudgetAutoStatus,
  type BudgetCapClientId } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BANGKOK, bangkokDay } from "@/lib/automation";
import { formatBudgetBaht } from "@/lib/automationBudget";

const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, dateStyle: "medium", timeStyle: "short" });
const blockers = new Map([
  ["NATIVE_AUTO_UNVERIFIED", "ยังยืนยันไม่ได้ว่า Auto Budget ของ TikTok ปิดอยู่"],
  ["NATIVE_AUTO_CONFLICT", "พักการเพิ่มงบ เพราะพบว่า Auto Budget ของ TikTok เปิดอยู่หรือข้อมูลขัดกัน"],
  ["SPEND_WATERMARK_MISSING", "รายงานไม่ระบุว่ายอดใช้เป็นข้อมูลถึงเวลาใด"],
  ["SPEND_UPDATE_PENDING", "รอยอดใช้จาก TikTok ที่ใหม่พอสำหรับตรวจเกณฑ์"],
  ["SPEND_TREND_PENDING", "รอให้ยอดใช้เพิ่มขึ้นจากรอบก่อนก่อนส่งคำสั่ง"],
  ["SPEND_TREND_UNAVAILABLE", "ยังอ่านยอดใช้ของแคมเปญเพื่อเทียบกับรอบก่อนไม่ได้"],
  ["LIVE_DELIVERY_UNVERIFIED", "ยังยืนยันไม่ได้ว่ากำลังไลฟ์และแคมเปญกำลังส่งโฆษณา"],
  ["LIVE_ROOM_REPORT_STALE", "TikTok ยังรายงานห้อง LIVE ที่เริ่มเกิน 24 ชั่วโมง ระบบยังยืนยันห้องปัจจุบันไม่ได้"],
  ["LIVE_ROOM_PREDATES_AUTO", "พบห้อง LIVE ที่เริ่มก่อนตั้งรอบนี้ หากต้องการใช้กับห้องปัจจุบัน ให้หยุดรอบรอแล้วเปิด Auto ใหม่เมื่อระบบยืนยันห้องนี้ได้"],
  ["LINE_NOT_READY", "ยังไม่พร้อมส่งแจ้งเตือนทาง LINE สำหรับ Creator นี้"],
  ["WRITE_LOCKED", "มีรายการปรับงบที่ยังต้องตรวจผลก่อนเริ่มรายการใหม่"],
  ["CONTEXT_UNAVAILABLE", "ยังอ่านข้อมูลแคมเปญหรือเพดานไม่ครบ"],
  ["SCHEDULED_CAP_TOO_LOW", "เพดานปัจจุบันไม่พอสำหรับการเพิ่มงบครั้งแรก 20%"],
  ["SCHEDULED_TARGET_NOT_EXACT", "งบปัจจุบันคำนวณยอดเพิ่ม 20% ไม่ลงตัวในหน่วยสตางค์"],
]);
const previews = new Map([
  ["WOULD_INCREASE", "ตามตัวเลขในรายงานเข้าเกณฑ์เพิ่มงบ"],
  [WAITING_FOR_LIVE, "พร้อมตั้ง Auto ให้รอ LIVE"],
  ["CONTEXT_UNVERIFIED", "ยังยืนยันข้อมูลงบหรือยอดใช้ไม่ครบ"],
  ["POLICY_UNAVAILABLE", "ยังอ่านเพดานงบไม่ได้"],
  ["POLICY_LOCKED", "เพดานถูกล็อกระหว่างตรวจผลรายการเดิม"],
  ["BELOW_THRESHOLD", "ยอดใช้ในรายงานยังไม่ถึงเกณฑ์"],
  ["TARGET_NOT_EXACT", "ยังคำนวณยอดเพิ่ม 20% ที่ส่งได้อย่างแม่นยำไม่ได้"],
  ["TARGET_BELOW_SPEND", "งบตามสูตรไม่สูงกว่ายอดที่ใช้ไปแล้ว"],
  ["CAMPAIGN_CAP_EXCEEDED", "งบตามสูตรจะเกินเพดานแคมเปญ"],
  ["CLIENT_DAILY_CAP_EXCEEDED", "ประมาณการรวมจะเกินเพดานรายวัน"],
]);
const modeLabels: Record<BudgetAutoStatus["mode"], string> = {
  disabled: "Auto ยังไม่เปิด", shadow: "ประเมินอย่างเดียว · ไม่เพิ่มงบ", live: "โหมดจริง · ทำงานเมื่อเปิดรอบและเข้าเกณฑ์",
};
const grantLabels = new Map([
  ["ARMED", "รอเข้าเกณฑ์"], ["RESERVED", "กำลังตรวจเงื่อนไขก่อนส่ง"], ["COMPLETED", "จบรอบแล้ว"],
  ["REVOKED", "หยุดแล้ว"], ["EXPIRED", "หมดเวลาแล้ว"], ["UNKNOWN", "ยังยืนยันผลไม่ได้"],
]);
const continuousLabels = {
  ARMED: "เปิดแล้ว · รอเข้าเกณฑ์",
  SENDING: "กำลังตรวจหรือส่งคำสั่ง",
  BLOCKED: "พักการเพิ่มงบ · ต้องตรวจข้อมูล",
  STOPPED: "หยุดแล้ว",
};
const continuousReasons = new Map([
  ["CAMPAIGN_ENDED", "ไม่พบแคมเปญที่เปิด Auto ไว้"],
  ["CAMPAIGN_CHANGED", "ไม่ใช่แคมเปญที่เปิด Auto ไว้"],
  ["CAMPAIGN_NOT_OBSERVED", "ไม่พบแคมเปญที่เปิด Auto ไว้"],
  ["LIVE_ENDED", "ไลฟ์จบหรือเปลี่ยนห้อง"],
  ["BASELINE_CHANGED", "งบหรือการตั้งค่าแคมเปญเปลี่ยนจากที่ยืนยันไว้"],
  ["CAP_CHANGED", "เพดานงบเปลี่ยนจากที่ยืนยันไว้"],
  ["OPERATOR_STOPPED", "ผู้ใช้งานกดหยุด"],
  ["OWNER_STOPPED", "ผู้ใช้งานกดหยุด"],
  ["AUTHORITY_REVOKED", "บัญชีไม่มีสิทธิ์เปิด Auto ต่อแล้ว"],
  ["AUTO_DISABLED", "ระบบปิดการเพิ่มงบอัตโนมัติ"],
  ["OUTCOME_UNKNOWN", "ยังยืนยันผลการปรับงบรอบก่อนไม่ได้"],
  ["NOT_SENT", "หยุดก่อนส่งคำสั่งปรับงบ"],
]);
const continuousRule = "ไม่จำกัดจำนวนครั้ง แต่ไม่เกินเพดานงบ · คำนวณจากงบปัจจุบันใหม่ทุกครั้ง";
const continuousStopRule = "หยุดเมื่อไม่พบแคมเปญที่เปิด Auto ไว้ หรือ LIVE จบหรือเปลี่ยนห้อง · กดหยุดเองได้";
const spendTrendRule = "เทียบยอดใช้จาก TikTok ทุก 1 นาที · เพิ่มได้เมื่อยอดใช้เพิ่มจากรอบก่อนเท่านั้น";
const spendTrendStopRule = "พักเมื่อยอดไม่เพิ่มหรืออ่านข้อมูลไม่ได้ · หยุดเมื่อไม่พบแคมเปญเดิม หรือกดหยุดเอง";
const spendTrendCaveat = "ยอดใช้ที่เพิ่มขึ้นเป็นสัญญาณแทนการยืนยัน LIVE และอาจมาจากข้อมูลที่รายงานล่าช้า";
const verifiedRoomSpendTrendRule = "ต้องยืนยันว่าเป็นห้อง LIVE เดิม และเห็นยอดใช้จาก TikTok เพิ่มขึ้นระหว่างการอ่านสองรอบก่อนส่งคำสั่ง";
const verifiedRoomSpendTrendCaveat = "ยอดใช้ที่เพิ่มอาจมาจากรายงานล่าช้า · เวลาที่ระบบอ่านรายงานไม่ใช่เวลาที่ TikTok อัปเดตยอดใช้";
const waitingForLiveLabel = "เปิดแล้ว · รอ LIVE";
const waitingForLiveRule = "เปิดรอได้โดยยังไม่เพิ่มงบ ระบบจะเพิ่มได้เมื่อยืนยันห้อง LIVE ของแคมเปญนี้ และยอดใช้เพิ่มขึ้นระหว่างการอ่านสองรอบตามเงื่อนไข";
const numericId = /^[1-9]\d{5,30}$/;
const isNumericId = (value: string | null | undefined): value is string => typeof value === "string" && numericId.test(value);

type AutoAttestation = "nativeAutoOff" | "noConcurrentChanges";
type AutoDraft = { strategy: "one-shot"; input: Omit<BudgetAutoArmInput, AutoAttestation> }
  | { strategy: "continuous"; evidenceMode: "verified-live"; input: Omit<BudgetAutoVerifiedContinuousArmInput, AutoAttestation> }
  | { strategy: "continuous"; evidenceMode: typeof VERIFIED_ROOM_SPEND_TREND; input: Omit<BudgetAutoVerifiedRoomSpendTrendArmInput, AutoAttestation> }
  | { strategy: "continuous"; evidenceMode: "spend-trend"; input: BudgetAutoSpendTrendArmInput };

function isContinuous(data: BudgetAutoStatus): boolean {
  return data.strategy === "continuous" && supportsContinuousAutoEvidence(data.clientId, data.evidenceMode);
}

function usesSpendTrend(data: BudgetAutoStatus): boolean {
  return isContinuous(data) && data.evidenceMode === "spend-trend";
}

function usesVerifiedRoomSpendTrend(data: BudgetAutoStatus): boolean {
  return isContinuous(data) && data.evidenceMode === VERIFIED_ROOM_SPEND_TREND;
}

function isWaitingArmPreview(data: BudgetAutoStatus, preview: NonNullable<BudgetAutoStatus["preview"]>): boolean {
  return supportsAutoWaitingForLive(data.clientId) && isContinuous(data) && preview.waitingForLive === true
    && preview.status === WAITING_FOR_LIVE && preview.liveSessionId === null && preview.spendMinor === null;
}

function sessionIsWaitingForLive(data: BudgetAutoStatus): boolean {
  return supportsAutoWaitingForLive(data.clientId) && usesVerifiedRoomSpendTrend(data)
    && data.continuousSession?.status === "ARMED" && data.continuousSession.waitingForLive === true;
}

function statusUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);
}

function Value({ label, value }: { label: string; value: number | null }) {
  return <div className="min-w-0">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="tabular mt-0.5 break-words font-semibold">{value === null ? "–" : formatBudgetBaht(value)}</dd>
  </div>;
}

function currentPreview(data: BudgetAutoStatus, campaignId: string | null, now: number, maxAge: number) {
  const readAt = data.preview ? Date.parse(data.preview.observedAt) : NaN;
  const age = now - readAt;
  return data.preview && campaignId === data.preview.campaignId && age >= -5_000 && age <= maxAge
    && bangkokDay(readAt) === bangkokDay(now) ? data.preview : null;
}

/** The server's explicit capability is necessary, including when spend is below threshold. */
export function getAutoArmPreview(data: BudgetAutoStatus, campaignId: string | null, now: number) {
  if (data.mode !== "live" || data.canArm !== true || data.blockers.length || data.grant !== null || data.canStop === true) return null;
  const continuous = isContinuous(data);
  if ((data.evidenceMode !== undefined || data.strategy === "continuous" || requiresVerifiedRoomSpendTrendAuto(data.clientId)) && !continuous) return null;
  if (data.continuousSession && (!continuous || data.continuousSession.status !== "STOPPED")) return null;
  const preview = currentPreview(data, campaignId, now, 45_000);
  if (!preview || !isNumericId(preview.campaignId)) return null;
  if (preview.waitingForLive === true) return isWaitingArmPreview(data, preview) ? preview : null;
  if (preview.spendMinor === null || (preview.status !== "BELOW_THRESHOLD" && preview.status !== "WOULD_INCREASE")) return null;
  return !continuous || usesSpendTrend(data) || isNumericId(preview.liveSessionId) ? preview : null;
}

/** A switch shows persisted authorization, never a draft, preview, or assumed successful write. */
export function autoFormSwitchState(data: BudgetAutoStatus, clientId: BudgetCapClientId): boolean | null {
  if (data.clientId !== clientId) return null;
  if (data.overviewState === "off") return false;
  const session = isContinuous(data) ? data.continuousSession : null;
  if (session) return session.status !== "STOPPED";
  if (data.grant) {
    if (data.grant.status === "ARMED" || data.grant.status === "RESERVED") return true;
    if (["COMPLETED", "REVOKED", "EXPIRED"].includes(data.grant.status)) return false;
    return null;
  }
  if (data.overviewState !== undefined) return null;
  return data.mode !== "live" || data.canArm === true ? false : null;
}

/** A recent fetch does not prove that the underlying provider spend is current. */
export function AutoBudgetStatusBody({ data, campaignId, now }: {
  data: BudgetAutoStatus;
  campaignId: string | null;
  now: number;
}) {
  const preview = currentPreview(data, campaignId, now, 180_000);
  const reasons = [...new Set(data.blockers.map((code) => blockers.get(code) ?? "มีเงื่อนไขความปลอดภัยที่ยังไม่ผ่าน"))];
  const continuous = isContinuous(data);
  const waitingPreview = preview !== null && isWaitingArmPreview(data, preview);
  const spendTrend = usesSpendTrend(data) && !waitingPreview;
  const verifiedRoomSpendTrend = usesVerifiedRoomSpendTrend(data) || waitingPreview;
  const session = continuous ? data.continuousSession : null;
  const waiting = data.mode === "live" && sessionIsWaitingForLive(data);
  const sessionReason = session?.reason ? continuousReasons.get(session.reason) ?? blockers.get(session.reason) ?? previews.get(session.reason) ?? "ระบบยังไม่ยืนยันเงื่อนไขให้เพิ่มงบ" : null;
  return <>
    <Badge variant="outline" className="mt-2 whitespace-normal">{continuous && data.mode === "live" ? "โหมดจริง · ทำงานเมื่อเปิด Auto และเข้าเกณฑ์" : modeLabels[data.mode]}</Badge>
    {session && <p className="mt-2 text-xs text-muted-foreground">สถานะ Auto ต่อเนื่อง: {waiting ? waitingForLiveLabel : continuousLabels[session.status]} · เริ่ม {time.format(new Date(session.startedAt))} (เวลาไทย){sessionReason ? ` · ${sessionReason}` : ""}</p>}
    {data.grant && <p className="mt-2 text-xs text-muted-foreground">รอบ Auto: {grantLabels.get(data.grant.status) ?? "ดูสถานะจากระบบ"} · สิ้นสุดตามกำหนด {time.format(new Date(data.grant.expiresAt))} (เวลาไทย)</p>}
    {preview ? <div className="mt-3 space-y-2">
      <p className="text-xs font-medium">{waiting && preview.waitingForLive ? "เปิดแล้ว · รอยืนยันห้อง LIVE" : previews.get(preview.status) ?? "ยังสรุปผลประเมินไม่ได้"}</p>
      {waitingPreview && <p className="text-xs text-muted-foreground">{waitingForLiveRule}</p>}
      <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
        <Value label="งบแคมเปญปัจจุบัน" value={preview.currentBudgetMinor} />
        <Value label="ยอดใช้จากรายงาน" value={preview.spendMinor} />
        <Value label="เกณฑ์ 80%" value={preview.thresholdMinor} />
        <Value label="งบใหม่ตามสูตร" value={preview.targetBudgetMinor} />
        <Value label="ประมาณการรวมหลังเพิ่ม" value={preview.projectedClientSpendMinor} />
      </dl>
      <p className="text-xs text-muted-foreground">อ่านรายงาน {time.format(new Date(preview.observedAt))} (เวลาไทย) · ไม่ใช่เวลาที่ TikTok อัปเดตยอดใช้</p>
    </div> : <p className="mt-2 text-xs text-muted-foreground">ยังไม่มีผลประเมินล่าสุดของแคมเปญนี้</p>}
    {reasons.length > 0 && <div className="mt-3 text-xs">
      <p className="font-medium">เหตุผลที่ยังไม่เพิ่มงบอัตโนมัติ</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        {reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </div>}
    {continuous && <details className="mt-2 text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer py-1">หลักเกณฑ์และข้อจำกัดของ Auto ต่อเนื่อง</summary>
      <p className="mt-1">{continuousRule} · {spendTrend ? spendTrendStopRule : continuousStopRule}</p>
      {spendTrend && <p className="mt-1">{spendTrendRule} · {spendTrendCaveat}</p>}
      {verifiedRoomSpendTrend && <p className="mt-1">{verifiedRoomSpendTrendRule} · {verifiedRoomSpendTrendCaveat}</p>}
    </details>}
  </>;
}

export function AutoBudgetControls({ data, campaignId, clientId, dataUpdatedAt, refresh, onChanged, variant = "panel", blockAutoStart = false,
  compactTitleId, compactDetailsId, onToggleCompactDetails, showCompactDetails = false }: {
  data: BudgetAutoStatus;
  campaignId: string | null;
  clientId: BudgetCapClientId;
  dataUpdatedAt: number;
  refresh: () => Promise<unknown>;
  onChanged?: () => void;
  variant?: "panel" | "campaign-form";
  blockAutoStart?: boolean;
  compactTitleId?: string;
  compactDetailsId?: string;
  onToggleCompactDetails?: () => void;
  showCompactDetails?: boolean;
}) {
  const [duration, setDuration] = useState("30");
  const [draft, setDraft] = useState<AutoDraft | null>(null);
  const [nativeOff, setNativeOff] = useState(false);
  const [exclusive, setExclusive] = useState(false);
  const [pending, setPending] = useState<"arm" | "stop" | null>(null);
  const [notice, setNotice] = useState("");
  const [lastAttemptAt, setLastAttemptAt] = useState<number | null>(null);
  const busy = useRef(false);
  const durationId = useId();
  const needsFreshRead = lastAttemptAt !== null && dataUpdatedAt <= lastAttemptAt;
  const preview = data.clientId === clientId ? getAutoArmPreview(data, campaignId, Date.now()) : null;
  const compact = variant === "campaign-form";
  const switchState = autoFormSwitchState(data, clientId);
  const continuous = isContinuous(data);
  const spendTrend = usesSpendTrend(data);
  const verifiedRoomSpendTrend = usesVerifiedRoomSpendTrend(data);
  const session = continuous ? data.continuousSession : null;
  const switchLabel = switchState === null ? data.overviewState === "blocked" ? "พักเพื่อตรวจข้อมูล" : "ยังยืนยันสถานะไม่ได้"
    : !switchState ? "ปิด" : session?.status === "BLOCKED" || data.overviewState === "blocked" ? "เปิดอยู่ · พักเพื่อตรวจข้อมูล"
      : data.mode !== "live" ? "เปิดอยู่ · ระบบไม่เพิ่มงบ" : sessionIsWaitingForLive(data) ? waitingForLiveLabel : "เปิด";
  const canStop = data.clientId === clientId && data.canStop === true;
  const stopSessionId = canStop && session && session.status !== "STOPPED" ? session.sessionId : null;
  const stopGrantId = canStop && data.grant && (data.grant.status === "ARMED" || data.grant.status === "RESERVED") ? data.grant.grantId : null;
  const stopId = stopSessionId ?? stopGrantId;
  const durationMinutes = /^\d{2,3}$/.test(duration) ? Number(duration) : NaN;
  const durationValid = Number.isSafeInteger(durationMinutes) && durationMinutes >= 10 && durationMinutes <= 120;
  const spendTrendDraft = draft?.strategy === "continuous" && draft.evidenceMode === "spend-trend";
  const waitingDraft = draft?.strategy === "continuous" && draft.evidenceMode === VERIFIED_ROOM_SPEND_TREND && draft.input.expectedLiveSessionId === null;
  const attestationComplete = spendTrendDraft || (nativeOff && exclusive);

  function matchesDraft() {
    const latest = data.clientId === clientId ? getAutoArmPreview(data, campaignId, Date.now()) : null;
    if (blockAutoStart || !latest || !draft || (draft.strategy === "continuous") !== continuous || latest.campaignId !== draft.input.expectedCampaignId
      || latest.currentBudgetMinor !== draft.input.expectedBudgetMinor || latest.policyRevision !== draft.input.expectedPolicyRevision) return false;
    if (draft.strategy !== "continuous") return true;
    const waiting = isWaitingArmPreview(data, latest);
    if (waiting || waitingDraft) return waiting && waitingDraft;
    if (draft.evidenceMode === "spend-trend") return spendTrend;
    return !spendTrend && (draft.evidenceMode === VERIFIED_ROOM_SPEND_TREND) === verifiedRoomSpendTrend
      && latest.liveSessionId === draft.input.expectedLiveSessionId;
  }

  function review(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (blockAutoStart || busy.current || needsFreshRead || !preview || (!continuous && !durationValid)) return;
    setNotice("");
    setNativeOff(false);
    setExclusive(false);
    const input = { expectedCampaignId: preview.campaignId, expectedBudgetMinor: preview.currentBudgetMinor,
      expectedPolicyRevision: preview.policyRevision };
    if (continuous) {
      // A scoped pending preview takes precedence over the ordinary immediate strategy.
      if (isWaitingArmPreview(data, preview)) {
        setDraft({ strategy: "continuous", evidenceMode: VERIFIED_ROOM_SPEND_TREND,
          input: { ...input, expectedLiveSessionId: null, evidenceMode: VERIFIED_ROOM_SPEND_TREND } });
      } else if (spendTrend) setDraft({ strategy: "continuous", evidenceMode: "spend-trend", input: { ...input, evidenceMode: "spend-trend" } });
      else if (verifiedRoomSpendTrend && isNumericId(preview.liveSessionId)) {
        setDraft({ strategy: "continuous", evidenceMode: VERIFIED_ROOM_SPEND_TREND,
          input: { ...input, expectedLiveSessionId: preview.liveSessionId, evidenceMode: VERIFIED_ROOM_SPEND_TREND } });
      } else if (isNumericId(preview.liveSessionId)) setDraft({ strategy: "continuous", evidenceMode: "verified-live",
        input: { ...input, expectedLiveSessionId: preview.liveSessionId } });
    } else setDraft({ strategy: "one-shot", input: { ...input, durationMinutes } });
  }

  async function confirm() {
    if (busy.current || needsFreshRead || !draft || !attestationComplete || !matchesDraft()) return;
    busy.current = true;
    setPending("arm");
    setNotice("");
    setLastAttemptAt(dataUpdatedAt);
    try {
      if (draft.strategy === "continuous") {
        const session = await armBudgetAutoContinuous(clientId, draft.evidenceMode === "spend-trend" ? draft.input
          : { ...draft.input, nativeAutoOff: true, noConcurrentChanges: true });
        setNotice(waitingDraft ? "บันทึกการเปิด Auto เพื่อรอ LIVE แล้ว · ยังไม่ยืนยันว่าเพิ่มงบ"
          : `บันทึกการเปิด Auto ต่อเนื่องแล้ว · เริ่ม ${time.format(new Date(session.startedAt))} (เวลาไทย) · ยังไม่ยืนยันว่าเพิ่มงบ`);
      } else {
        const grant = await armBudgetAuto(clientId, { ...draft.input, nativeAutoOff: true, noConcurrentChanges: true });
        setNotice(`บันทึกรอบ Auto แล้ว · สิ้นสุด ${time.format(new Date(grant.expiresAt))} (เวลาไทย) · ยังไม่ยืนยันว่าเพิ่มงบ`);
      }
      onChanged?.();
    } catch {
      setNotice("ยังยืนยันการเปิดรอบไม่ได้ กรุณาตรวจสถานะล่าสุดก่อนส่งคำสั่งใหม่");
    } finally {
      setDraft(null);
      setNativeOff(false);
      setExclusive(false);
      try { await refresh(); } catch { /* Do not retry a write if its result is unclear. */ }
      busy.current = false;
      setPending(null);
    }
  }

  async function stop() {
    if (busy.current || needsFreshRead || !stopId) return;
    busy.current = true;
    setPending("stop");
    setNotice("");
    setLastAttemptAt(dataUpdatedAt);
    try {
      const result = stopSessionId ? await stopBudgetAutoContinuous(clientId, stopSessionId) : await stopBudgetAuto(clientId, stopId);
      setNotice(result.stopped
        ? `บันทึกการหยุด${stopSessionId ? " Auto ต่อเนื่อง" : "รอบ Auto"}แล้ว · คำสั่งที่ส่งไปก่อนหน้านี้อาจยังมีผล`
        : "ยังยืนยันการหยุดไม่ได้ กรุณาตรวจสถานะล่าสุดก่อนส่งคำสั่งใหม่");
      if (result.stopped) onChanged?.();
    } catch {
      setNotice("ยังยืนยันการหยุดไม่ได้ กรุณาตรวจสถานะล่าสุดก่อนส่งคำสั่งใหม่");
    } finally {
      try { await refresh(); } catch { /* The server is authoritative on the active grant. */ }
      busy.current = false;
      setPending(null);
    }
  }

  if (!compact && !preview && !stopId && !draft && !notice && !pending) return null;
  return <div className={compact ? "space-y-1.5 text-sm" : "mt-3 space-y-2 border-t border-border pt-3 text-sm"}>
    {compact && <>
      <AutomationDisclosureRow title="Auto budget increase" titleId={compactTitleId} layout="compact-auto-row"
        controlsId={compactDetailsId ?? `${durationId}-details`} expanded={showCompactDetails} onToggle={onToggleCompactDetails ?? (() => {})} status={pending
        ? <span role="status">{pending === "stop" ? "กำลังตรวจผลการหยุด…" : "กำลังเปิด Auto…"}</span>
        : <span>{switchLabel}{!switchState && !stopId ? blockAutoStart ? " · มีรายการงบค้าง" : !campaignId ? " · ยังไม่ยืนยันแคมเปญ" : "" : ""}</span>} trailingControl={
        switchState !== null ? <button type="button" role="switch" aria-checked={switchState} aria-label="Auto budget increase"
          disabled={pending !== null || needsFreshRead || (switchState ? !stopId : !!stopId || !preview || blockAutoStart || draft !== null || (!continuous && !durationValid))}
          onClick={() => { if (switchState) void stop(); else review(); }}
          className="flex size-11 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50">
          <AutomationSwitchTrack checked={switchState} />
        </button> : <span aria-hidden className="mx-1 h-5 w-9 rounded-full border border-dashed border-muted-foreground/50" />}
      />
      {switchState !== true && stopId && <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null || needsFreshRead} onClick={() => void stop()}>หยุด Auto</Button>}
      {showCompactDetails && !draft && preview && !continuous && <label htmlFor={durationId} className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
        ระยะเวลาเปิด Auto (10–120 นาที)
        <Input id={durationId} type="text" inputMode="numeric" maxLength={3} value={duration} onChange={(event) => setDuration(event.target.value)} className="w-20" disabled={pending !== null || needsFreshRead || blockAutoStart} />
      </label>}
    </>}
    {!compact && stopId && <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null || needsFreshRead} onClick={() => void stop()}>
      {pending === "stop" ? "กำลังตรวจผลการหยุด…" : stopSessionId ? "หยุด Auto ต่อเนื่อง" : "หยุดรอบ Auto"}
    </Button>}
    {draft ? <div className="space-y-2">
      <p className="font-medium">{waitingDraft ? "เปิด Auto ล่วงหน้าเพื่อรอ LIVE ของแคมเปญนี้"
        : draft.strategy === "continuous" ? "เปิด Auto ต่อเนื่องสำหรับแคมเปญนี้ทันที" : `เปิด Auto สำหรับแคมเปญนี้ทันที ${draft.input.durationMinutes} นาที`}</p>
      <p className="text-xs text-muted-foreground">ฐานงบ {formatBudgetBaht(draft.input.expectedBudgetMinor)} · {draft.strategy === "continuous" ? continuousRule : "เพิ่มได้สูงสุดหนึ่งครั้งเมื่อเข้าเกณฑ์"} · ใช้เงินจริง</p>
      {draft.strategy === "continuous" && (draft.evidenceMode === "spend-trend"
        ? <p className="text-xs text-muted-foreground">{spendTrendRule} · {spendTrendCaveat} · เริ่มได้แม้ไม่ทราบสถานะ Auto Budget ของ TikTok แต่จะพักหากพบว่ากำลังเปิดอยู่</p>
        : waitingDraft ? <p className="text-xs text-muted-foreground">{waitingForLiveRule} · {continuousStopRule} · {verifiedRoomSpendTrendCaveat}</p>
        : <p className="text-xs text-muted-foreground">LIVE ID <span className="tabular break-all">{draft.input.expectedLiveSessionId}</span> · {continuousStopRule}
          {draft.evidenceMode === VERIFIED_ROOM_SPEND_TREND && ` · ${verifiedRoomSpendTrendRule} · ${verifiedRoomSpendTrendCaveat}`}</p>)}
      {!matchesDraft() && <p role="status" className="text-xs text-muted-foreground">{draft.strategy === "continuous" && draft.evidenceMode !== "spend-trend" ? "ข้อมูลแคมเปญ ห้อง LIVE งบ เพดาน หรือสิทธิ์เปลี่ยนแล้ว กรุณาเริ่มตรวจใหม่" : "ข้อมูลแคมเปญ งบ เพดาน หรือสิทธิ์เปลี่ยนแล้ว กรุณาเริ่มตรวจใหม่"}</p>}
      {!spendTrendDraft && <>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={nativeOff} disabled={pending !== null || !matchesDraft()} onChange={(event) => setNativeOff(event.target.checked)} />ปิด Auto Budget ของ TikTok แล้ว</label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={exclusive} disabled={pending !== null || !matchesDraft()} onChange={(event) => setExclusive(event.target.checked)} />ไม่มีคนหรือระบบอื่นแก้งบพร้อมกันในช่วงนี้</label>
      </>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-10" disabled={!matchesDraft() || !attestationComplete || pending !== null || needsFreshRead} onClick={() => void confirm()}>{pending === "arm" ? "กำลังเปิด Auto…" : waitingDraft ? "ยืนยันเปิด Auto รอ LIVE" : draft.strategy === "continuous" ? "ยืนยันเปิด Auto ต่อเนื่อง ใช้เงินจริง" : "ยืนยันเปิด Auto ใช้เงินจริง"}</Button>
        <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => setDraft(null)}>ยกเลิก</Button>
      </div>
    </div> : !compact && preview && <form className="space-y-2" onSubmit={review}>
      {!continuous && <label htmlFor={durationId} className="block font-medium">ระยะเวลาเปิด Auto (10–120 นาที)</label>}
      <div className="flex flex-wrap items-center gap-2">
        {!continuous && <Input id={durationId} type="text" inputMode="numeric" maxLength={3} value={duration} onChange={(event) => setDuration(event.target.value)} className="w-24" disabled={pending !== null || needsFreshRead} />}
        <Button type="submit" variant="outline" className="min-h-10" disabled={(!continuous && !durationValid) || pending !== null || needsFreshRead || blockAutoStart}>ตรวจเงื่อนไขก่อนเปิด Auto{continuous ? " ต่อเนื่อง" : ""}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{continuous ? "เริ่มทันทีหลังยืนยัน · ไม่ต้องตั้งระยะเวลา" : "เริ่มทันทีหลังยืนยัน ไม่ใช่การตั้งเวลาเริ่มล่วงหน้า"}</p>
    </form>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {needsFreshRead && pending === null && <Button type="button" variant="ghost" className="min-h-10" onClick={() => void refresh()}>ตรวจสถานะ Auto ล่าสุด</Button>}
  </div>;
}

/** Invalidate display-only summaries and any previous detailed key after a confirmed change. */
export function invalidateOtherAutoBudgetViews(queryClient: QueryClient, userId: number, clientId: BudgetCapClientId, campaignId: string | null) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["automation", "budget-auto-overview", userId, clientId], exact: true }),
    queryClient.invalidateQueries({ queryKey: ["automation", "budget-auto-status", userId, clientId],
      predicate: (candidate) => candidate.queryKey[4] !== campaignId }),
  ]);
}

/** Mounted only for the expanded, scoped Creator row; server capabilities govern all controls. */
export function AutoBudgetStatusPanel({ clientId, userId, campaignId, variant = "panel", blockAutoStart = false }: {
  clientId: BudgetCapClientId;
  userId: number;
  campaignId: string | null;
  variant?: "panel" | "campaign-form";
  blockAutoStart?: boolean;
}) {
  const titleId = useId();
  const detailsId = useId();
  const [showDetails, setShowDetails] = useState(false);
  const queryClient = useQueryClient();
  const compact = variant === "campaign-form";
  // The scoped ledger summary already exposes a verified Stop action. Do not
  // ask TikTok for arming facts merely because the Edit form was opened.
  const readCompactSummary = compact && campaignId === null;
  const query = useQuery({
    queryKey: readCompactSummary ? ["automation", "budget-auto-overview", userId, clientId] : ["automation", "budget-auto-status", userId, clientId, campaignId],
    queryFn: ({ signal }) => readCompactSummary ? fetchBudgetAutoOverviewStatus(clientId, signal) : fetchBudgetAutoStatus(clientId, signal),
    retry: false,
    gcTime: 0,
    staleTime: 30_000,
    refetchInterval: (state) => statusUnavailable(state.state.error) ? false
      : !readCompactSummary && (state.state.data?.canArm === true || state.state.data?.canStop === true) ? 20_000 : 60_000,
    refetchIntervalInBackground: false,
  });
  if (!compact && statusUnavailable(query.error)) return null;
  const pendingText = query.isPending ? "กำลังตรวจสถานะ Auto…" : "ยังอ่านสถานะ Auto ไม่ได้";
  const toggleDetails = () => setShowDetails((open) => !open);
  const controls = query.isSuccess && <AutoBudgetControls key={`${userId}:${clientId}:${campaignId ?? "none"}`} data={query.data} clientId={clientId}
    campaignId={campaignId} dataUpdatedAt={query.dataUpdatedAt} refresh={query.refetch} variant={variant} blockAutoStart={blockAutoStart}
    compactTitleId={titleId} compactDetailsId={detailsId} onToggleCompactDetails={toggleDetails} showCompactDetails={showDetails}
    onChanged={() => {
      // In summary mode the current query and overview are the same; the control's immediate refresh is enough.
      if (!readCompactSummary) void invalidateOtherAutoBudgetViews(queryClient, userId, clientId, campaignId);
    }} />;
  if (compact) return <section className={automationDisclosureFrame} aria-labelledby={titleId}>
    {controls || <AutomationDisclosureRow title="Auto budget increase" titleId={titleId} layout="compact-auto-row"
      status={<span role="status">{pendingText}</span>} controlsId={detailsId} expanded={showDetails} onToggle={toggleDetails} />}
    <AutomationDisclosureBody id={detailsId} expanded={showDetails} className="space-y-1.5 text-xs text-muted-foreground">
        <p>ใช้ถึง 80% → เพิ่มงบ 20% เมื่อผ่านเพดานและเงื่อนไขความปลอดภัย</p>
        <p>ยอดใช้จากรายงานอาจล่าช้า และไม่ได้ยืนยันว่ากำลังไลฟ์อยู่</p>
        {blockAutoStart && <p>จัดการรายการงบหรือเพดานที่ค้างก่อนเปิด Auto</p>}
        {readCompactSummary ? <p>ต้องยืนยันแคมเปญที่เปิดอยู่ก่อนเปิด Auto</p>
          : query.isSuccess && <AutoBudgetStatusBody data={query.data} campaignId={campaignId} now={Date.now()} />}
    </AutomationDisclosureBody>
  </section>;

  return <section className="mt-3 min-w-0 rounded-lg border border-border bg-card p-3.5 sm:p-4" aria-labelledby={titleId}>
    <h3 id={titleId} className="flex items-center gap-2 text-base font-semibold"><Activity className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />เพิ่มงบอัตโนมัติ</h3>
    <p className="mt-1 text-sm text-muted-foreground">ใช้ถึง 80% → เพิ่มงบ 20% เมื่อผ่านเพดานและเงื่อนไขความปลอดภัย</p>
    <p className="mt-1 text-xs text-muted-foreground">ยอดใช้จากรายงาน TikTok อาจล่าช้า และการอ่านรายงานสำเร็จไม่ยืนยันว่ากำลังไลฟ์อยู่</p>
    {query.isSuccess
      ? <>
        <AutoBudgetStatusBody data={query.data} campaignId={campaignId} now={Date.now()} />
        {controls}
      </>
      : <p role="status" className="mt-2 text-xs text-muted-foreground">
        {pendingText}
      </p>}
  </section>;
}
