import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, http, request } from "@/api/client";
import { BANGKOK } from "@/lib/automation";
import { formatBudgetBaht } from "@/lib/automationBudget";

const endpoint = "/automation/budget/auto/diagnostics";
const date = z.string().datetime({ offset: true });
const money = z.number().int().safe().positive();
const historyStatus = z.enum(["APPLIED_VERIFIED", "NOT_SENT", "OUTCOME_UNKNOWN", "PROVIDER_REJECTED"]);
const lineStatus = z.enum(["PENDING", "ACCEPTED", "UNCONFIRMED", "UNKNOWN"]);
const schema = z.object({
  lastTickAt: date.nullable(), lastValidReadAt: date.nullable(), heartbeatStale: z.boolean(),
  reason: z.string().max(100).nullable(),
  history: z.array(z.object({ operationId: z.string().uuid(), checkedAt: date, status: historyStatus,
    previousBudgetMinor: money, targetBudgetMinor: money, observedBudgetMinor: money.nullable(),
    lineStatus: lineStatus.optional() })).max(20),
});
const clock = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const time = (value: string | null) => value ? clock.format(new Date(value)) : "—";
const reasonText: Record<string, string> = {
  NOT_ARMED: "ยังไม่เปิดรอบ Auto", SESSION_STOPPED: "รอบ Auto หยุดแล้ว", AUTO_DISABLED: "โหมดเงินจริงปิดอยู่",
  AUTHORITY_REVOKED: "สิทธิ์ผู้เปิดรอบเปลี่ยน", LEGACY_BUSY: "รอรายการเดิม", CAMPAIGN_ENDED: "ไม่พบแคมเปญเดิม",
  LIVE_ENDED: "TikTok ยืนยันว่า LIVE จบ", CAP_CHANGED: "เพดานเปลี่ยน ต้องเปิดรอบใหม่", BASELINE_CHANGED: "งบหรือการตั้งค่าเปลี่ยน",
  BASELINE_ADOPTED: "ใช้ยอดงบใหม่เป็นฐาน", CONTEXT_UNAVAILABLE: "อ่านข้อมูลจาก TikTok ไม่ครบ",
  NATIVE_AUTO_CONFLICT: "พบ Auto Budget อื่นหรือข้อมูลขัดกัน", NATIVE_AUTO_UNVERIFIED: "ยังยืนยัน Auto Budget ไม่ได้",
  LIVE_DELIVERY_UNVERIFIED: "ยังยืนยัน LIVE ไม่ได้", SPEND_WATERMARK_MISSING: "ข้อมูลไม่ระบุเวลาของยอดใช้",
  SPEND_UPDATE_PENDING: "รอข้อมูลยอดใช้ใหม่", LINE_NOT_READY: "LINE ยังไม่พร้อม", WRITE_LOCKED: "รอตรวจรายการก่อนหน้า",
  BELOW_THRESHOLD: "ยอดใช้ยังไม่ถึง 80%", SPEND_TREND_PENDING: "รอยอดใช้เพิ่มจากรอบก่อน", CAP_REACHED: "งบถัดไปจะเกินเพดาน",
  TARGET_UNAVAILABLE: "งบตามสูตรไม่ผ่านเงื่อนไข", PENDING: "กำลังตรวจผล", NOT_SENT: "ไม่ได้ส่งคำสั่ง จะรอตรวจอีกครั้ง",
  OUTCOME_UNKNOWN: "ยังยืนยันผลกับ TikTok ไม่ได้ ระบบจะไม่ส่งซ้ำ", APPLIED_VERIFIED: "ยืนยันงบใหม่จาก TikTok แล้ว", ERROR: "รอบตรวจขัดข้อง",
};
const resultText: Record<z.infer<typeof historyStatus>, string> = {
  APPLIED_VERIFIED: "ปรับแล้ว", NOT_SENT: "ไม่ได้ส่ง", OUTCOME_UNKNOWN: "ผลไม่ชัดเจน", PROVIDER_REJECTED: "TikTok ไม่รับคำสั่ง",
};
const lineText: Record<z.infer<typeof lineStatus>, string> = {
  PENDING: "LINE รอส่ง", ACCEPTED: "LINE รับข้อความแล้ว", UNCONFIRMED: "ยังยืนยันการส่ง LINE ไม่ได้", UNKNOWN: "ยังไม่ทราบสถานะ LINE",
};

const hidden = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0);

export function AutoDiagnosticsPanel({ userId }: { userId: number }) {
  const query = useQuery({ queryKey: ["automation", "ppan-auto-diagnostics", userId],
    queryFn: ({ signal }) => request(schema, endpoint, () => http.get(endpoint, { signal, timeout: 10_000 })),
    staleTime: 25_000, gcTime: 0, refetchInterval: (query) => hidden(query.state.error) ? false : 60_000, retry: false });
  if (hidden(query.error)) return null;
  if (!query.data) return query.isError ? <p className="text-xs text-muted-foreground">ยังโหลดประวัติ Auto ไม่ได้</p> : null;
  const { lastTickAt, lastValidReadAt, heartbeatStale, reason, history } = query.data;
  return <section className="space-y-2 border-t pt-3" aria-label="การทำงานล่าสุดของ Auto">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h4 className="text-sm font-medium">การทำงานล่าสุด</h4>
      <span className="text-xs text-muted-foreground">ตรวจ {time(lastTickAt)} · อ่าน TikTok {time(lastValidReadAt)}</span>
    </div>
    <p className={heartbeatStale ? "text-sm text-amber-700 dark:text-amber-300" : "text-sm text-muted-foreground"}>
      {heartbeatStale ? "ขาดรอบตรวจล่าสุด · ควรตรวจสถานะระบบ" : reason ? reasonText[reason] ?? "ดูสถานะในประวัติ" : "ยังไม่มีรอบตรวจ"}
    </p>
    {history.length > 0 && <details className="rounded-md border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">ประวัติการเพิ่มงบ ({history.length})</summary>
      <ul className="mt-2 divide-y">{history.map(item => <li key={item.operationId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-xs">
        <span>{time(item.checkedAt)} · {formatBudgetBaht(item.previousBudgetMinor)} → {formatBudgetBaht(item.targetBudgetMinor)}</span>
        <span className="text-muted-foreground">{resultText[item.status]}{item.status === "APPLIED_VERIFIED" ? ` · ${lineText[item.lineStatus ?? "UNKNOWN"]}` : ""}</span>
      </li>)}</ul>
    </details>}
  </section>;
}
