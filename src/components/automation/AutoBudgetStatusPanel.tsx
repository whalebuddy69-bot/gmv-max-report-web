import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { fetchBudgetAutoStatus, type BudgetAutoStatus, type BudgetCapClientId } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { BANGKOK, bangkokDay } from "@/lib/automation";
import { formatBudgetBaht } from "@/lib/automationBudget";

const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, dateStyle: "medium", timeStyle: "short" });
const blockers = new Map([
  ["NATIVE_AUTO_UNVERIFIED", "ยังยืนยันไม่ได้ว่า Auto Budget ของ TikTok ปิดอยู่"],
  ["SPEND_WATERMARK_MISSING", "รายงานไม่ระบุว่ายอดใช้เป็นข้อมูลถึงเวลาใด"],
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
  disabled: "Auto ยังไม่เปิด", shadow: "ประเมินอย่างเดียว · ไม่เพิ่มงบ", live: "โหมดจริง · ดูสถานะเท่านั้น",
};

function statusUnavailable(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);
}

function Value({ label, value }: { label: string; value: number | null }) {
  return <div className="min-w-0">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="tabular mt-0.5 break-words font-semibold">{value === null ? "–" : formatBudgetBaht(value)}</dd>
  </div>;
}

/** A recent fetch does not prove that the underlying provider spend is current. */
export function AutoBudgetStatusBody({ data, campaignId, now }: {
  data: BudgetAutoStatus;
  campaignId: string | null;
  now: number;
}) {
  const readAt = data.preview ? Date.parse(data.preview.observedAt) : NaN;
  const age = now - readAt;
  const preview = data.preview && campaignId === data.preview.campaignId && age >= -5_000 && age <= 180_000
    && bangkokDay(readAt) === bangkokDay(now) ? data.preview : null;
  const reasons = [...new Set(data.blockers.map((code) => blockers.get(code) ?? "มีเงื่อนไขความปลอดภัยที่ยังไม่ผ่าน"))];
  return <>
    <Badge variant="outline" className="mt-2 whitespace-normal">{modeLabels[data.mode]}</Badge>
    {preview ? <div className="mt-3 space-y-2">
      <p className="text-xs font-medium">{previews.get(preview.status) ?? "ยังสรุปผลประเมินไม่ได้"}</p>
      <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-3">
        <Value label="งบแคมเปญปัจจุบัน" value={preview.currentBudgetMinor} />
        <Value label="ยอดใช้จากรายงาน" value={preview.spendMinor} />
        <Value label="เกณฑ์ 80%" value={preview.thresholdMinor} />
        <Value label="งบใหม่ตามสูตร" value={preview.targetBudgetMinor} />
        <Value label="ประมาณการรวมหลังเพิ่ม" value={preview.projectedClientSpendMinor} />
      </dl>
      <p className="text-xs text-muted-foreground">อ่านรายงาน {time.format(readAt)} (เวลาไทย) · ไม่ใช่เวลาที่ TikTok อัปเดตยอดใช้</p>
    </div> : <p className="mt-2 text-xs text-muted-foreground">ยังไม่มีผลประเมินล่าสุดของแคมเปญนี้</p>}
    {reasons.length > 0 && <div className="mt-3 text-xs">
      <p className="font-medium">เหตุผลที่ยังไม่เพิ่มงบอัตโนมัติ</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
        {reasons.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
    </div>}
  </>;
}

/** Mounted only for the expanded, scoped Creator row. It never invokes a write endpoint. */
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
    refetchInterval: (state) => statusUnavailable(state.state.error) ? false : 60_000,
    refetchIntervalInBackground: false,
  });
  if (statusUnavailable(query.error)) return null;
  return <section className="mt-3 min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4" aria-labelledby={titleId}>
    <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold"><Activity className="h-4 w-4 shrink-0" aria-hidden /> เพิ่มงบอัตโนมัติ</h2>
    <p className="mt-1 text-sm text-muted-foreground">ใช้ถึง 80% → เพิ่มงบ 20% เมื่อผ่านเพดานและเงื่อนไขความปลอดภัย</p>
    <p className="mt-1 text-xs text-muted-foreground">ยอดใช้จากรายงาน TikTok อาจล่าช้า และการอ่านรายงานสำเร็จไม่ยืนยันว่ากำลังไลฟ์อยู่</p>
    {query.isSuccess
      ? <AutoBudgetStatusBody data={query.data} campaignId={campaignId} now={Date.now()} />
      : <p role="status" className="mt-2 text-xs text-muted-foreground">
        {query.isPending ? "กำลังตรวจสถานะ Auto…" : "ยังอ่านสถานะ Auto ไม่ได้"}
      </p>}
  </section>;
}
