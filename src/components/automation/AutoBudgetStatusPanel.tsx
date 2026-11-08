import { useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { PILOT_BUDGET_CLIENT_ID } from "@/api/automation";
import { armBudgetAuto, armBudgetAutoContinuous, fetchBudgetAutoStatus, isContinuousBudgetClientId, stopBudgetAuto, stopBudgetAutoContinuous,
  type BudgetAutoArmInput, type BudgetAutoSpendTrendArmInput, type BudgetAutoVerifiedContinuousArmInput, type BudgetAutoStatus,
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
  ["LINE_NOT_READY", "ยังไม่พร้อมส่งแจ้งเตือนทาง LINE สำหรับ Creator นี้"],
  ["WRITE_LOCKED", "มีรายการปรับงบที่ยังต้องตรวจผลก่อนเริ่มรายการใหม่"],
  ["CONTEXT_UNAVAILABLE", "ยังอ่านข้อมูลแคมเปญหรือเพดานไม่ครบ"],
]);
const previews = new Map([
  ["WOULD_INCREASE", "ตามตัวเลขในรายงานเข้าเกณฑ์เพิ่มงบ"],
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
const numericId = /^[1-9]\d{5,30}$/;
const isNumericId = (value: string | null | undefined): value is string => typeof value === "string" && numericId.test(value);

type AutoAttestation = "nativeAutoOff" | "noConcurrentChanges";
type AutoDraft = { strategy: "one-shot"; input: Omit<BudgetAutoArmInput, AutoAttestation> }
  | { strategy: "continuous"; evidenceMode: "verified-live"; input: Omit<BudgetAutoVerifiedContinuousArmInput, AutoAttestation> }
  | { strategy: "continuous"; evidenceMode: "spend-trend"; input: BudgetAutoSpendTrendArmInput };

function isContinuous(data: BudgetAutoStatus): boolean {
  return isContinuousBudgetClientId(data.clientId) && data.strategy === "continuous"
    && (data.clientId === PILOT_BUDGET_CLIENT_ID || data.evidenceMode === "spend-trend");
}

function usesSpendTrend(data: BudgetAutoStatus): boolean {
  return isContinuous(data) && data.evidenceMode === "spend-trend";
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
  if ((data.evidenceMode === "spend-trend" && !usesSpendTrend(data)) || (data.strategy === "continuous" && !isContinuous(data))
    || (data.continuousSession && (!isContinuous(data) || data.continuousSession.status !== "STOPPED"))) return null;
  const preview = currentPreview(data, campaignId, now, 45_000);
  return preview && isNumericId(preview.campaignId) && (!isContinuous(data) || usesSpendTrend(data) || isNumericId(preview.liveSessionId))
    && (preview.status === "BELOW_THRESHOLD" || preview.status === "WOULD_INCREASE") ? preview : null;
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
  const spendTrend = usesSpendTrend(data);
  const session = continuous ? data.continuousSession : null;
  const sessionReason = session?.reason ? continuousReasons.get(session.reason) ?? blockers.get(session.reason) ?? previews.get(session.reason) ?? "ระบบยังไม่ยืนยันเงื่อนไขให้เพิ่มงบ" : null;
  return <>
    <Badge variant="outline" className="mt-2 whitespace-normal">{continuous && data.mode === "live" ? "โหมดจริง · ทำงานเมื่อเปิด Auto และเข้าเกณฑ์" : modeLabels[data.mode]}</Badge>
    {session && <p className="mt-2 text-xs text-muted-foreground">สถานะ Auto ต่อเนื่อง: {continuousLabels[session.status]} · เริ่ม {time.format(new Date(session.startedAt))} (เวลาไทย){sessionReason ? ` · ${sessionReason}` : ""}</p>}
    {data.grant && <p className="mt-2 text-xs text-muted-foreground">รอบ Auto: {grantLabels.get(data.grant.status) ?? "ดูสถานะจากระบบ"} · สิ้นสุดตามกำหนด {time.format(new Date(data.grant.expiresAt))} (เวลาไทย)</p>}
    {preview ? <div className="mt-3 space-y-2">
      <p className="text-xs font-medium">{previews.get(preview.status) ?? "ยังสรุปผลประเมินไม่ได้"}</p>
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
    </details>}
  </>;
}

export function AutoBudgetControls({ data, campaignId, clientId, dataUpdatedAt, refresh }: {
  data: BudgetAutoStatus;
  campaignId: string | null;
  clientId: BudgetCapClientId;
  dataUpdatedAt: number;
  refresh: () => Promise<unknown>;
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
  const continuous = isContinuous(data);
  const spendTrend = usesSpendTrend(data);
  const session = continuous ? data.continuousSession : null;
  const canStop = data.clientId === clientId && data.canStop === true;
  const stopSessionId = canStop && session && session.status !== "STOPPED" ? session.sessionId : null;
  const stopGrantId = canStop && data.grant && (data.grant.status === "ARMED" || data.grant.status === "RESERVED") ? data.grant.grantId : null;
  const stopId = stopSessionId ?? stopGrantId;
  const durationMinutes = /^\d{2,3}$/.test(duration) ? Number(duration) : NaN;
  const durationValid = Number.isSafeInteger(durationMinutes) && durationMinutes >= 10 && durationMinutes <= 120;
  const spendTrendDraft = draft?.strategy === "continuous" && draft.evidenceMode === "spend-trend";
  const attestationComplete = spendTrendDraft || (nativeOff && exclusive);

  function matchesDraft() {
    const latest = data.clientId === clientId ? getAutoArmPreview(data, campaignId, Date.now()) : null;
    return !!latest && !!draft && (draft.strategy === "continuous") === continuous && latest.campaignId === draft.input.expectedCampaignId
      && latest.currentBudgetMinor === draft.input.expectedBudgetMinor && latest.policyRevision === draft.input.expectedPolicyRevision
      && (draft.strategy !== "continuous" || (draft.evidenceMode === "spend-trend"
        ? spendTrend : !spendTrend && latest.liveSessionId === draft.input.expectedLiveSessionId));
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || needsFreshRead || !preview || (!continuous && !durationValid)) return;
    setNotice("");
    setNativeOff(false);
    setExclusive(false);
    const input = { expectedCampaignId: preview.campaignId, expectedBudgetMinor: preview.currentBudgetMinor,
      expectedPolicyRevision: preview.policyRevision };
    if (continuous) {
      if (spendTrend) setDraft({ strategy: "continuous", evidenceMode: "spend-trend", input: { ...input, evidenceMode: "spend-trend" } });
      else if (isNumericId(preview.liveSessionId)) {
        setDraft({ strategy: "continuous", evidenceMode: "verified-live", input: { ...input, expectedLiveSessionId: preview.liveSessionId } });
      }
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
        setNotice(`บันทึกการเปิด Auto ต่อเนื่องแล้ว · เริ่ม ${time.format(new Date(session.startedAt))} (เวลาไทย) · ยังไม่ยืนยันว่าเพิ่มงบ`);
      } else {
        const grant = await armBudgetAuto(clientId, { ...draft.input, nativeAutoOff: true, noConcurrentChanges: true });
        setNotice(`บันทึกรอบ Auto แล้ว · สิ้นสุด ${time.format(new Date(grant.expiresAt))} (เวลาไทย) · ยังไม่ยืนยันว่าเพิ่มงบ`);
      }
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
    } catch {
      setNotice("ยังยืนยันการหยุดไม่ได้ กรุณาตรวจสถานะล่าสุดก่อนส่งคำสั่งใหม่");
    } finally {
      try { await refresh(); } catch { /* The server is authoritative on the active grant. */ }
      busy.current = false;
      setPending(null);
    }
  }

  if (!preview && !stopId && !draft && !notice && !pending) return null;
  return <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
    {stopId && <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null || needsFreshRead} onClick={() => void stop()}>
      {pending === "stop" ? "กำลังตรวจผลการหยุด…" : stopSessionId ? "หยุด Auto ต่อเนื่อง" : "หยุดรอบ Auto"}
    </Button>}
    {draft ? <div className="space-y-2">
      <p className="font-medium">{draft.strategy === "continuous" ? "เปิด Auto ต่อเนื่องสำหรับแคมเปญนี้ทันที" : `เปิด Auto สำหรับแคมเปญนี้ทันที ${draft.input.durationMinutes} นาที`}</p>
      <p className="text-xs text-muted-foreground">ฐานงบ {formatBudgetBaht(draft.input.expectedBudgetMinor)} · {draft.strategy === "continuous" ? continuousRule : "เพิ่มได้สูงสุดหนึ่งครั้งเมื่อเข้าเกณฑ์"} · ใช้เงินจริง</p>
      {draft.strategy === "continuous" && (draft.evidenceMode === "spend-trend"
        ? <p className="text-xs text-muted-foreground">{spendTrendRule} · {spendTrendCaveat} · เริ่มได้แม้ไม่ทราบสถานะ Auto Budget ของ TikTok แต่จะพักหากพบว่ากำลังเปิดอยู่</p>
        : <p className="text-xs text-muted-foreground">LIVE ID <span className="tabular break-all">{draft.input.expectedLiveSessionId}</span> · {continuousStopRule}</p>)}
      {!matchesDraft() && <p role="status" className="text-xs text-muted-foreground">{draft.strategy === "continuous" && draft.evidenceMode === "verified-live" ? "ข้อมูลแคมเปญ ห้อง LIVE งบ เพดาน หรือสิทธิ์เปลี่ยนแล้ว กรุณาเริ่มตรวจใหม่" : "ข้อมูลแคมเปญ งบ เพดาน หรือสิทธิ์เปลี่ยนแล้ว กรุณาเริ่มตรวจใหม่"}</p>}
      {!spendTrendDraft && <>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={nativeOff} disabled={pending !== null || !matchesDraft()} onChange={(event) => setNativeOff(event.target.checked)} />ปิด Auto Budget ของ TikTok แล้ว</label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={exclusive} disabled={pending !== null || !matchesDraft()} onChange={(event) => setExclusive(event.target.checked)} />ไม่มีคนหรือระบบอื่นแก้งบพร้อมกันในช่วงนี้</label>
      </>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="min-h-10" disabled={!matchesDraft() || !attestationComplete || pending !== null || needsFreshRead} onClick={() => void confirm()}>{pending === "arm" ? "กำลังเปิด Auto…" : draft.strategy === "continuous" ? "ยืนยันเปิด Auto ต่อเนื่อง ใช้เงินจริง" : "ยืนยันเปิด Auto ใช้เงินจริง"}</Button>
        <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => setDraft(null)}>ยกเลิก</Button>
      </div>
    </div> : preview && <form className="space-y-2" onSubmit={review}>
      {!continuous && <label htmlFor={durationId} className="block font-medium">ระยะเวลาเปิด Auto (10–120 นาที)</label>}
      <div className="flex flex-wrap items-center gap-2">
        {!continuous && <Input id={durationId} type="text" inputMode="numeric" maxLength={3} value={duration} onChange={(event) => setDuration(event.target.value)} className="w-24" disabled={pending !== null || needsFreshRead} />}
        <Button type="submit" variant="outline" className="min-h-10" disabled={(!continuous && !durationValid) || pending !== null || needsFreshRead}>ตรวจเงื่อนไขก่อนเปิด Auto{continuous ? " ต่อเนื่อง" : ""}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{continuous ? "เริ่มทันทีหลังยืนยัน · ไม่ต้องตั้งระยะเวลา" : "เริ่มทันทีหลังยืนยัน ไม่ใช่การตั้งเวลาเริ่มล่วงหน้า"}</p>
    </form>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {needsFreshRead && pending === null && <Button type="button" variant="ghost" className="min-h-10" onClick={() => void refresh()}>ตรวจสถานะ Auto ล่าสุด</Button>}
  </div>;
}

/** Mounted only for the expanded, scoped Creator row; server capabilities govern all controls. */
export function AutoBudgetStatusPanel({ clientId, userId, campaignId }: {
  clientId: BudgetCapClientId;
  userId: number;
  campaignId: string | null;
}) {
  const titleId = useId();
  const query = useQuery({
    queryKey: ["automation", "budget-auto-status", userId, clientId, campaignId],
    queryFn: ({ signal }) => fetchBudgetAutoStatus(clientId, signal),
    retry: false,
    gcTime: 0,
    staleTime: 30_000,
    refetchInterval: (state) => statusUnavailable(state.state.error) ? false
      : state.state.data?.canArm === true || state.state.data?.canStop === true ? 20_000 : 60_000,
    refetchIntervalInBackground: false,
  });
  if (statusUnavailable(query.error)) return null;
  return <section className="mt-3 min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4" aria-labelledby={titleId}>
    <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold"><Activity className="h-4 w-4 shrink-0" aria-hidden /> เพิ่มงบอัตโนมัติ</h2>
    <p className="mt-1 text-sm text-muted-foreground">ใช้ถึง 80% → เพิ่มงบ 20% เมื่อผ่านเพดานและเงื่อนไขความปลอดภัย</p>
    <p className="mt-1 text-xs text-muted-foreground">ยอดใช้จากรายงาน TikTok อาจล่าช้า และการอ่านรายงานสำเร็จไม่ยืนยันว่ากำลังไลฟ์อยู่</p>
    {query.isSuccess
      ? <>
        <AutoBudgetStatusBody data={query.data} campaignId={campaignId} now={Date.now()} />
        <AutoBudgetControls key={`${userId}:${clientId}:${campaignId ?? "none"}`} data={query.data} clientId={clientId} campaignId={campaignId} dataUpdatedAt={query.dataUpdatedAt} refresh={query.refetch} />
      </>
      : <p role="status" className="mt-2 text-xs text-muted-foreground">
        {query.isPending ? "กำลังตรวจสถานะ Auto…" : "ยังอ่านสถานะ Auto ไม่ได้"}
      </p>}
  </section>;
}
