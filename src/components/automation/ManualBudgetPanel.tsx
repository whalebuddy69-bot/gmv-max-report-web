import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, LockKeyhole, RefreshCw, SlidersHorizontal } from "lucide-react";
import type { AutomationClient } from "@/api/automation";
import { confirmBudgetChange, fetchBudgetStatus, prepareBudgetChange, readBudgetOperation, type AutomationBudgetOperation, type AutomationBudgetPreparation } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BANGKOK } from "@/lib/automation";
import { budgetResultMatches, canConfirmBudget, canPrepareBudget, freshBudgetCap, isTerminalBudgetResult, parseBudgetBaht, preparationMatchesRequest, validDirection, type BudgetDirection } from "@/lib/automationBudget";

const bahtNumber = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const money = (minor: number) => {
  const amount = BigInt(minor);
  return `฿${bahtNumber.format(amount / 100n)}.${String(amount % 100n).padStart(2, "0")}`;
};
const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, timeStyle: "medium" });
const formatTime = (value: string) => time.format(new Date(value));
const STORAGE_PREFIX = "gmv-max-automation-budget-operation-v1:";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CAP_QUERY_KEY = "budget-status";

function savedOperation(userId: number): string | null {
  try {
    const value = sessionStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    return value && UUID.test(value) ? value : null;
  } catch { return null; }
}

// Persist only the opaque request ID, not financial data or user credentials.
function saveOperation(userId: number, operationId: string | null) {
  try {
    const key = `${STORAGE_PREFIX}${userId}`;
    if (operationId) sessionStorage.setItem(key, operationId);
    else sessionStorage.removeItem(key);
  } catch { /* Private-mode storage can be disabled. The backend still guards replay. */ }
}

function denied(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403 || error.status === 404);
}

function prepareError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403) return "บัญชีนี้ยังไม่ได้รับสิทธิ์สั่งปรับงบ";
    if (error.status === 409) return "ข้อมูลแคมเปญ งบ หรือเพดานเปลี่ยนแล้ว หรือมีรายการค้างอยู่ กรุณาอัปเดตข้อมูลก่อนสร้างรายการใหม่";
    if (error.status === 429) return "มีคำขอมากเกินไป กรุณารอสักครู่";
    if (error.status === 400) return "ยอดที่ระบุไม่ผ่านเงื่อนไข กรุณาตรวจยอดและเพดานอีกครั้ง";
  }
  return "ยังเตรียมรายการไม่ได้ ระบบไม่ได้ส่งคำสั่งปรับงบให้ TikTok";
}

export function BudgetOutcome({ operationId, result }: { operationId: string; result: AutomationBudgetOperation | null }) {
  let headline: string;
  let description: string;
  const status = result?.status === "APPLIED_VERIFIED" && result.observedBudgetMinor === null
    ? "OUTCOME_UNKNOWN"
    : result?.status ?? "OUTCOME_UNKNOWN";
  switch (status) {
    case "APPLIED_VERIFIED":
      headline = "ปรับงบสำเร็จและยืนยันจาก TikTok แล้ว";
      description = result?.observedBudgetMinor != null ? `งบที่อ่านกลับ ${money(result.observedBudgetMinor)}` : "ยังอ่านยอดที่ยืนยันไม่ได้";
      break;
    case "SIMULATED":
      headline = "ทดสอบขั้นตอนสำเร็จ — ไม่ได้แก้งบจริง";
      description = "ไม่มีการส่งคำสั่งปรับงบไปที่ TikTok";
      break;
    case "NOT_SENT":
      headline = "ไม่ได้ส่งคำสั่งปรับงบ";
      description = "ตรวจข้อมูลล่าสุดก่อนเริ่มรายการใหม่";
      break;
    case "PROVIDER_REJECTED":
      headline = "TikTok ปฏิเสธคำสั่ง";
      description = "ตรวจสถานะและงบล่าสุดใน TikTok ก่อนดำเนินการต่อ";
      break;
    case "PROCESSING":
      headline = "กำลังรอผลจากระบบ";
      description = "ใช้ปุ่มตรวจสอบผลด้านล่าง ไม่ต้องกดยืนยันซ้ำ";
      break;
    case "PREPARED":
      headline = "ยังไม่พบผลของคำยืนยัน";
      description = "สถานะยังไม่ยืนยันว่าคำสั่งถูกส่งหรือไม่ กรุณาตรวจสอบผลอีกครั้ง";
      break;
    default:
      headline = "ยังยืนยันผลไม่ได้ — อย่าส่งคำสั่งซ้ำ";
      description = "ตรวจสอบผลอีกครั้ง หรือเช็กงบใน TikTok Ads Manager แล้วแจ้งรหัสรายการให้ผู้ดูแล";
  }
  const variant = status === "APPLIED_VERIFIED" || status === "SIMULATED" ? "success" : "warning";
  return (
    <div role="status" className="rounded-md border border-border bg-muted/50 p-3 text-sm">
      <Badge variant={variant} className="max-w-full whitespace-normal">{headline}</Badge>
      <p className="mt-2">{description}</p>
      <p className="mt-2 break-all text-xs text-muted-foreground">รหัสรายการ: <code>{operationId}</code></p>
    </div>
  );
}

export function ManualBudgetPanel({ userId, clients, onRefreshCampaign, active = true }: {
  userId: number;
  clients: AutomationClient[];
  onRefreshCampaign: () => void;
  active?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const [direction, setDirection] = useState<BudgetDirection | null>(null);
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<AutomationBudgetPreparation | null>(null);
  const [nativeOff, setNativeOff] = useState(false);
  const [noConcurrentChanges, setNoConcurrentChanges] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(() => savedOperation(userId));
  const [result, setResult] = useState<AutomationBudgetOperation | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pending, setPending] = useState<"prepare" | "confirm" | "check" | null>(null);
  const busy = useRef(false);
  const attemptedOperation = useRef(operationId);
  const query = useQuery({
    queryKey: ["automation", CAP_QUERY_KEY, userId],
    queryFn: ({ signal }) => fetchBudgetStatus(signal),
    enabled: active,
    gcTime: 0,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (state) => !active || denied(state.state.error) ? false : 20_000,
  });
  const status = query.isSuccess ? query.data : null;
  const client = status ? clients.find((value) => value.clientId === status.clientId) ?? null : null;
  const visibleMode = client ? status?.mode ?? "disabled" : "disabled";
  const campaign = client?.campaign;
  const enabled = canPrepareBudget(status, client, now);
  const cap = client && freshBudgetCap(status, now) ? status?.cap ?? null : null;
  const readyToConfirm = !!review && canConfirmBudget(review, status, client, now);
  const terminal = result !== null && isTerminalBudgetResult(result.status);
  const actualMode = review?.mode === "live";

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  function clearDraft() {
    setReview(null);
    setDirection(null);
    setAmount("");
    setNativeOff(false);
    setNoConcurrentChanges(false);
    setErrorText(null);
  }

  function startDraft(next: BudgetDirection) {
    if (busy.current || attemptedOperation.current || !canPrepareBudget(status, client, Date.now())) return;
    clearDraft();
    setDirection(next);
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || attemptedOperation.current || review || !status || !campaign || !direction || !canPrepareBudget(status, client, Date.now())) return;
    const target = parseBudgetBaht(amount);
    if (target === null) { setErrorText("กรอกงบเป็นบาทมากกว่า 0 และไม่เกิน 2 ตำแหน่งทศนิยม"); return; }
    if (!validDirection(target, campaign.dailyBudgetMinor, direction)) {
      setErrorText(direction === "increase" ? "งบใหม่ต้องมากกว่างบปัจจุบัน" : "งบใหม่ต้องน้อยกว่างบปัจจุบัน"); return;
    }
    if (!status.cap || target > status.cap.campaignCapMinor) { setErrorText("งบใหม่เกินเพดานแคมเปญ"); return; }
    if (campaign.spendMinor !== null && target <= campaign.spendMinor) {
      setErrorText("งบใหม่ต้องสูงกว่ายอดใช้ไปแล้ว"); return;
    }
    const input = { expectedCampaignId: campaign.campaignId, expectedBudgetMinor: campaign.dailyBudgetMinor, targetBudgetMinor: target };
    busy.current = true;
    setPending("prepare");
    setErrorText(null);
    try {
      const prepared = await prepareBudgetChange(input);
      if (!preparationMatchesRequest(prepared, input, status, Date.now())) {
        setErrorText("รายการที่ได้รับไม่ตรงกับงบหรือเพดานที่เห็น จึงยังไม่เปิดให้ยืนยัน");
        void query.refetch();
        onRefreshCampaign();
        return;
      }
      setReview(prepared);
    } catch (error) {
      setErrorText(prepareError(error));
      void query.refetch();
      onRefreshCampaign();
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function acceptResult(value: AutomationBudgetOperation, expectedId: string) {
    if (!budgetResultMatches(value, expectedId, review?.targetBudgetMinor ?? null, review?.mode ?? null)) {
      setErrorText("ผลที่ได้รับไม่ตรงกับรายการเดิม จึงยังไม่ยืนยันว่าเปลี่ยนงบแล้ว");
      return;
    }
    setResult(value);
    if (isTerminalBudgetResult(value.status)) {
      void query.refetch();
      onRefreshCampaign();
    }
  }

  async function confirm() {
    if (busy.current || attemptedOperation.current || !review || !nativeOff || !noConcurrentChanges || !canConfirmBudget(review, status, client, Date.now())) return;
    busy.current = true;
    const id = review.operationId;
    // A refresh or dropped connection must not offer a second POST for this operation.
    attemptedOperation.current = id;
    saveOperation(userId, id);
    setOperationId(id);
    setPending("confirm");
    setErrorText(null);
    try {
      acceptResult(await confirmBudgetChange(id), id);
    } catch {
      setErrorText("ไม่สามารถยืนยันผลจากการเชื่อมต่อครั้งนี้ได้ กรุณาใช้ปุ่มตรวจสอบผล ไม่ส่งคำสั่งเดิมซ้ำ");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  async function checkResult() {
    if (busy.current || !operationId) return;
    busy.current = true;
    setPending("check");
    setErrorText(null);
    try {
      acceptResult(await readBudgetOperation(operationId), operationId);
    } catch {
      setErrorText("ยังอ่านผลของรายการนี้ไม่ได้ กรุณาตรวจใน TikTok Ads Manager หรือแจ้งรหัสรายการให้ผู้ดูแล");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  function closeResult() {
    if (busy.current || !terminal) return;
    saveOperation(userId, null);
    attemptedOperation.current = null;
    setOperationId(null);
    setResult(null);
    clearDraft();
  }

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="automation-budget">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="automation-budget" className="flex items-center gap-2 text-base font-semibold"><SlidersHorizontal className="h-4 w-4" aria-hidden /> ปรับงบจากเว็บ</h2>
          <p className="mt-1 text-sm text-muted-foreground">ตรวจเพดานและยืนยันทีละรายการสำหรับ {client?.displayName ?? "Creator ที่ได้รับสิทธิ์"} · LINE ใช้แจ้งเตือน ไม่ใช้สั่งปรับงบ</p>
        </div>
        <Badge variant={visibleMode === "live" ? "warning" : "secondary"}>
          {visibleMode === "live" ? "โหมดส่งคำสั่งจริง" : visibleMode === "dry-run" ? "ทดลอง · ไม่แก้งบจริง" : "ยังไม่เปิดสิทธิ์สั่งงาน"}
        </Badge>
      </div>

      {cap ? (
        <dl className="mt-4 grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">เพดานต่อแคมเปญ</dt><dd className="font-medium tabular">{money(cap.campaignCapMinor)}</dd></div>
          <div><dt className="text-muted-foreground">เพดานรวมวันนี้</dt><dd className="font-medium tabular">{money(cap.clientDailyCapMinor)}</dd></div>
          <div className="text-xs text-muted-foreground sm:col-span-2"><dt className="sr-only">ที่มาและเวลา</dt><dd>อ้างอิงเพดานที่ตั้งไว้ในระบบเดิม · อ่าน {formatTime(cap.readAt)} น. เวลาไทย</dd></div>
        </dl>
      ) : <p className="mt-4 text-sm text-muted-foreground">{query.isPending ? "กำลังตรวจสิทธิ์และเพดาน…" : "ยังไม่มีเพดานล่าสุดที่ยืนยันได้"}</p>}
      <p className="mt-2 text-xs text-muted-foreground">แก้เพดาน Ppan ผ่าน LINE ที่จับคู่ไว้ด้วย <code>ตั้งเพดาน Ppan [จำนวนบาท]</code> แล้วกดยืนยัน เว็บนี้ยังแสดงเพดานแบบอ่านอย่างเดียว</p>

      {operationId ? (
        <div className="mt-4 space-y-2">
          {pending === "confirm" ? <p role="status" className="text-sm">กำลังตรวจและรอผลของรายการนี้…</p> : <BudgetOutcome operationId={operationId} result={result} />}
          {!terminal ? (
            <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={() => void checkResult()}>ตรวจสอบผลรายการ</Button>
          ) : <Button type="button" variant="outline" className="min-h-10" onClick={closeResult}>ปิดผลรายการ</Button>}
        </div>
      ) : review ? (
        <div className="mt-4 space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-semibold">{actualMode ? "ตรวจรายการก่อนส่งคำสั่งจริง" : "ตรวจรายการจำลอง · ไม่แก้งบจริง"}</p>
          <p className="break-words text-sm">แคมเปญ {campaign?.campaignId === review.campaignId ? campaign.campaignName : "ที่เตรียมไว้"} · <span className="break-all font-mono text-xs">{review.campaignId}</span></p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-muted-foreground">งบเดิม</dt><dd className="font-semibold tabular">{money(review.currentBudgetMinor)}</dd></div>
            <div><dt className="text-muted-foreground">งบใหม่</dt><dd className="font-semibold tabular">{money(review.targetBudgetMinor)}</dd></div>
            <div><dt className="text-muted-foreground">ประมาณการรวมหลังปรับ</dt><dd className="tabular">{money(review.projectedClientSpendMinor)}</dd></div>
            <div><dt className="text-muted-foreground">เพดานรวมวันนี้</dt><dd className="tabular">{money(review.cap.clientDailyCapMinor)}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">เพดานแคมเปญ {money(review.cap.campaignCapMinor)} · ยืนยันได้ถึง {formatTime(review.expiresAt)} น. เวลาไทย</p>
          {!readyToConfirm && <p role="status" className="text-sm text-muted-foreground">รายการหมดเวลา หรือสถานะแคมเปญ งบ เพดาน หรือสิทธิ์เปลี่ยนแล้ว จึงไม่สามารถยืนยันได้</p>}
          <label className="flex min-h-10 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={nativeOff} onChange={(event) => setNativeOff(event.target.checked)} disabled={!readyToConfirm || pending !== null} />ยืนยันว่าปิด Auto Budget ของ TikTok แล้ว</label>
          <label className="flex min-h-10 items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={noConcurrentChanges} onChange={(event) => setNoConcurrentChanges(event.target.checked)} disabled={!readyToConfirm || pending !== null} />ยืนยันว่าไม่มีคนหรือระบบอื่นแก้งบพร้อมกัน</label>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-10" disabled={!readyToConfirm || !nativeOff || !noConcurrentChanges || pending !== null} onClick={() => void confirm()}>{actualMode ? "ยืนยันและส่งคำสั่งจริง" : "ยืนยันการทดลอง"}</Button>
            <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={clearDraft}>ปิดแบบร่าง</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {!enabled && <p className="flex items-start gap-2 text-xs text-muted-foreground"><LockKeyhole className="mt-px h-4 w-4 shrink-0" aria-hidden />{cap?.locked ? "มีรายการที่ยังต้องตรวจสอบ จึงยังไม่เปิดให้ปรับงบอีกครั้ง" : status?.mode === "disabled" ? "บัญชีนี้ยังไม่ได้เปิดสิทธิ์สั่งปรับงบ" : "ต้องยืนยันสิทธิ์ แคมเปญปัจจุบัน ยอดใช้ และเพดานล่าสุดก่อน"}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="min-h-10" disabled={!enabled || pending !== null} aria-pressed={direction === "increase"} onClick={() => startDraft("increase")}><ArrowUp className="h-4 w-4" aria-hidden />เพิ่มงบ</Button>
            <Button type="button" variant="outline" className="min-h-10" disabled={!enabled || pending !== null} aria-pressed={direction === "decrease"} onClick={() => startDraft("decrease")}><ArrowDown className="h-4 w-4" aria-hidden />ลดงบ</Button>
            <Button type="button" variant="ghost" className="min-h-10" disabled={query.isFetching || pending !== null || denied(query.error)} onClick={() => { void query.refetch(); onRefreshCampaign(); }}><RefreshCw className="h-4 w-4" aria-hidden />ตรวจสิทธิ์และเพดาน</Button>
          </div>
          {direction && campaign && (
            <form onSubmit={(event) => void prepare(event)} className="space-y-2 rounded-md border border-border p-3">
              <label htmlFor="automation-new-budget" className="block text-sm font-medium">งบใหม่เป็นบาท · ปัจจุบัน {money(campaign.dailyBudgetMinor)}</label>
              <Input id="automation-new-budget" type="text" inputMode="decimal" autoComplete="off" maxLength={25} value={amount} onChange={(event) => setAmount(event.target.value)} disabled={!enabled || pending !== null} />
              <p className="text-xs text-muted-foreground">การเตรียมรายการยังไม่ส่งคำสั่งไป TikTok</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" className="min-h-10" disabled={!enabled || pending !== null || !amount.trim()}>{pending === "prepare" ? "กำลังตรวจข้อมูล…" : "ตรวจและเตรียมรายการ"}</Button>
                <Button type="button" variant="outline" className="min-h-10" disabled={pending !== null} onClick={clearDraft}>ยกเลิก</Button>
              </div>
            </form>
          )}
        </div>
      )}
      {errorText && <p role="alert" className="mt-3 break-words text-sm text-destructive">{errorText}</p>}
    </section>
  );
}
