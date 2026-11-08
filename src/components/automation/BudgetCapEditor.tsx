import { useEffect, useId, useRef, useState, type ComponentProps, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, RefreshCw } from "lucide-react";
import { changeBudgetCap, fetchAdditionalBudgetCapStatus, isAdditionalBudgetCapClientId, type AdditionalBudgetCapClientId, type BudgetCapClientId, type BudgetCapStatus } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BANGKOK } from "@/lib/automation";
import { budgetCapResultMatches, canConfirmBudgetCap, canEditBudgetCap, formatBudgetBaht, freshBudgetCap, parseBudgetBaht, type BudgetCapReview } from "@/lib/automationBudget";
import { cn } from "@/lib/utils";

const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, timeStyle: "medium" });

export function CampaignAmountField({ className, ...props }: Omit<ComponentProps<typeof Input>, "type" | "inputMode">) {
  return <div className="flex min-w-0 max-w-xs items-center rounded-md border border-input bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring">
    <Input {...props} type="text" inputMode="decimal" className={cn("h-11 min-w-0 border-0 bg-transparent text-base tabular-nums shadow-none focus-visible:ring-0 sm:text-sm", className)} />
    <span aria-hidden className="shrink-0 border-l border-border px-3 text-sm font-medium text-muted-foreground">THB</span>
  </div>;
}

function capChangeError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 403 || error.status === 404) return "บัญชีนี้ยังไม่มีสิทธิ์แก้เพดานจากเว็บ";
    if (error.status === 409) return "เพดานเปลี่ยนแล้วหรือมีรายการปรับงบที่ยังต้องตรวจสอบ กรุณาดูเพดานล่าสุดก่อนเริ่มใหม่";
    if (error.status === 400) return "เพดานใหม่ไม่ผ่านเงื่อนไข กรุณาตรวจจำนวนเงินแล้วเริ่มใหม่";
    if (error.status === 429) return "มีคำขอมากเกินไป กรุณารอสักครู่";
  }
  return "ยังยืนยันผลการบันทึกไม่ได้ กรุณาตรวจเพดานล่าสุดก่อนเริ่มใหม่ ระบบจะไม่ส่งคำสั่งเดิมซ้ำ";
}

export function BudgetCapEditor({
  active, blocked = false, clientId, displayName, status, loading, refreshStatus, onEditingChange, variant,
}: {
  active: boolean;
  blocked?: boolean;
  clientId: BudgetCapClientId;
  displayName: string;
  status: BudgetCapStatus | null;
  loading: boolean;
  refreshStatus: () => Promise<unknown>;
  onEditingChange?: (editing: boolean) => void;
  variant?: "campaign-form";
}) {
  const [now, setNow] = useState(Date.now);
  const [draft, setDraft] = useState<{ amount: string; review: BudgetCapReview | null } | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const inputId = useId();
  const known = status?.clientId === clientId ? status : null;
  const cap = known && freshBudgetCap(known, now) ? known.cap : null;
  const canEdit = active && !blocked && canEditBudgetCap(known, clientId, now);
  const canConfirm = canEdit && !!draft?.review && canConfirmBudgetCap(draft.review, known, clientId, now);
  const unset = known && !known.cap && isAdditionalBudgetCapClientId(clientId);
  const compact = variant === "campaign-form";

  useEffect(() => {
    if (!active && !compact) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, compact]);

  function openDraft() {
    if (busy.current || !active || blocked || !canEditBudgetCap(known, clientId, Date.now())) return;
    setNotice(null);
    setDraft({ amount: variant === "campaign-form" && cap ? formatBudgetBaht(cap.clientDailyCapMinor).slice(1) : "", review: null });
    onEditingChange?.(true);
  }

  function cancelDraft() {
    if (busy.current) return;
    setDraft(null);
    setNotice(null);
    onEditingChange?.(false);
  }

  function stage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !active || blocked || !draft || draft.review || !canEditBudgetCap(known, clientId, Date.now())) return;
    const target = parseBudgetBaht(draft.amount);
    if (target === null) {
      setNotice({ kind: "error", message: "กรอกเพดานเป็นบาทมากกว่า 0 และไม่เกิน 2 ตำแหน่งทศนิยม" });
      return;
    }
    const current = known?.cap?.campaignCapMinor ?? null;
    if (target === current) {
      setNotice({ kind: "error", message: "เพดานใหม่ต้องต่างจากเพดานปัจจุบัน" });
      return;
    }
    setNotice(null);
    setDraft({ ...draft, review: { expectedRevision: known?.cap?.revision ?? 0, currentCapMinor: current, capMinor: target } });
  }

  async function confirm() {
    const review = draft?.review;
    if (busy.current || !active || blocked || !review || !canConfirmBudgetCap(review, known, clientId, Date.now())) return;
    const input = { expectedRevision: review.expectedRevision, capMinor: review.capMinor };
    busy.current = true;
    setSubmitting(true);
    setNotice(null);
    try {
      const saved = await changeBudgetCap(clientId, input);
      setNotice(budgetCapResultMatches(saved, input)
        ? { kind: "success", message: `บันทึกเพดาน ${formatBudgetBaht(saved.capMinor)} แล้ว · ไม่ได้เปลี่ยนงบ TikTok` }
        : { kind: "error", message: capChangeError(null) });
    } catch (error) {
      setNotice({ kind: "error", message: capChangeError(error) });
    } finally {
      // Reconcile with a read, including if the POST may have landed without a response.
      // This closes the review so a failure never offers a second submit.
      setDraft(null);
      try { await refreshStatus(); } catch { /* A failed read doesn't send another write. */ }
      busy.current = false;
      setSubmitting(false);
      onEditingChange?.(false);
    }
  }

  return (
    <div>
      {compact ? (!draft || !!draft.review) && <div className="space-y-1.5">
        <label htmlFor={inputId} className="sr-only">Daily Ceiling (THB)</label>
        <CampaignAmountField id={inputId} readOnly value={cap ? formatBudgetBaht(cap.clientDailyCapMinor).slice(1) : ""} placeholder="—" />
        {!cap && <p className="text-xs text-muted-foreground">{loading ? "กำลังตรวจสิทธิ์และเพดาน…" : unset ? "ยังไม่ได้ตั้งเพดานงบ" : "ยังไม่มีเพดานล่าสุดที่ยืนยันได้"}</p>}
        {cap && cap.clientDailyCapMinor !== cap.campaignCapMinor && <p className="text-xs text-muted-foreground">เพดานต่อแคมเปญ {formatBudgetBaht(cap.campaignCapMinor)} · ต่างจากเพดานรวมต่อวัน</p>}
      </div> : cap ? (
        <dl className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">เพดานต่อแคมเปญ</dt><dd className="font-medium tabular">{formatBudgetBaht(cap.campaignCapMinor)}</dd></div>
          <div><dt className="text-muted-foreground">เพดานรวมวันนี้</dt><dd className="font-medium tabular">{formatBudgetBaht(cap.clientDailyCapMinor)}</dd></div>
          <div className="text-xs text-muted-foreground sm:col-span-2"><dt className="sr-only">เวลาอ่านเพดาน</dt><dd>อ่านล่าสุด {time.format(new Date(cap.readAt))} น. เวลาไทย</dd></div>
        </dl>
      ) : <p className="text-sm text-muted-foreground">{loading ? "กำลังตรวจสิทธิ์และเพดาน…" : unset ? "ยังไม่ได้ตั้งเพดานงบ" : "ยังไม่มีเพดานล่าสุดที่ยืนยันได้"}</p>}
      {known?.capEditAllowed === true && !draft && (
        <Button type="button" variant="outline" className="mt-3 min-h-10" disabled={!canEdit || submitting} onClick={openDraft}>
          <Pencil className="h-4 w-4" aria-hidden />{unset ? "ตั้งเพดานงบ" : "แก้เพดานงบ"}
        </Button>
      )}
      {draft?.review ? (
        <div className="mt-3 space-y-3 rounded-md border border-border p-3">
          <p className="text-sm font-semibold">ตรวจเพดานใหม่ของ {displayName}</p>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">เพดานเดิม</dt><dd className="font-semibold tabular">{draft.review.currentCapMinor === null ? "ยังไม่ได้ตั้ง" : formatBudgetBaht(draft.review.currentCapMinor)}</dd></div>
            <div><dt className="text-muted-foreground">เพดานใหม่</dt><dd className="font-semibold tabular">{formatBudgetBaht(draft.review.capMinor)}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">ใช้จำนวนเดียวกันทั้งต่อแคมเปญและยอดรวมต่อวัน ไม่ลดงบที่ตั้งอยู่ และไม่เปิด Auto เอง</p>
          {!canConfirm && !submitting && <p role="status" className="text-sm text-muted-foreground">เพดานหรือสิทธิ์เปลี่ยนแล้ว กรุณายกเลิกและตรวจข้อมูลล่าสุด</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-10" disabled={!canConfirm || submitting} onClick={() => void confirm()}>
              {submitting ? "กำลังบันทึก…" : "ยืนยันเพดานใหม่"}
            </Button>
            <Button type="button" variant="outline" className="min-h-10" disabled={submitting} onClick={cancelDraft}>ยกเลิกแก้เพดาน</Button>
          </div>
        </div>
      ) : draft ? (
        <form onSubmit={stage} className={compact ? "space-y-2" : "mt-3 space-y-2 rounded-md border border-border p-3"}>
          <label htmlFor={inputId} className="block text-sm font-medium">เพดานใหม่ของ {displayName} (บาท)</label>
          {compact ? <CampaignAmountField id={inputId} autoComplete="off" maxLength={25} placeholder="เช่น 30,000" value={draft.amount} disabled={!canEdit}
            onChange={(event) => setDraft({ amount: event.target.value, review: null })} />
            : <Input id={inputId} type="text" inputMode="decimal" autoComplete="off" maxLength={25} placeholder="เช่น 30,000" value={draft.amount} disabled={!canEdit} onChange={(event) => setDraft({ amount: event.target.value, review: null })} />}
          <p className="text-xs text-muted-foreground">เปลี่ยนเพดานเป็นกติกาสำหรับครั้งถัดไป ไม่ใช่การปรับงบ TikTok</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-10" disabled={!canEdit || !draft.amount.trim()}>ตรวจเพดานใหม่</Button>
            <Button type="button" variant="outline" className="min-h-10" onClick={cancelDraft}>ยกเลิกแก้เพดาน</Button>
          </div>
        </form>
      ) : null}
      {notice && <p role={notice.kind === "success" ? "status" : "alert"} className={`mt-3 text-sm${notice.kind === "error" ? " text-destructive" : ""}`}>{notice.message}</p>}
    </div>
  );
}

export function AdditionalBudgetCapPanel({ active, userId, clientId, displayName, blocked, onEditingChange, refreshBudgetStatus, variant }: {
  active: boolean; userId: number; clientId: AdditionalBudgetCapClientId; displayName: string; blocked: boolean; onEditingChange: (editing: boolean) => void;
  refreshBudgetStatus: () => Promise<unknown>;
  variant?: "campaign-form";
}) {
  const titleId = useId();
  const compact = variant === "campaign-form";
  const query = useQuery({
    queryKey: ["automation", "cap-status", userId, clientId],
    queryFn: ({ signal }) => fetchAdditionalBudgetCapStatus(clientId, signal),
    enabled: active || compact,
    gcTime: 0,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (state) => !active || state.state.error ? false : 20_000,
  });
  const status = query.isSuccess ? query.data : null;
  const editor = <BudgetCapEditor active={active} clientId={clientId} displayName={displayName}
    status={status} loading={query.isPending} refreshStatus={() => Promise.all([query.refetch(), refreshBudgetStatus()])}
    blocked={blocked} onEditingChange={onEditingChange} variant={variant} />;
  if (compact) return editor;
  return (
    <section className="min-w-0" aria-labelledby={titleId}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={titleId} className="text-base font-semibold">เพดานงบ {displayName}</h2>
          <p className="mt-1 text-sm text-muted-foreground">ผู้ได้รับสิทธิ์เปลี่ยนเพดานจากเว็บได้ โดยไม่ปรับงบ TikTok</p>
        </div>
        <Button type="button" variant="ghost" className="min-h-10" disabled={!active || query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw className="h-4 w-4" aria-hidden />ตรวจเพดานล่าสุด
        </Button>
      </div>
      {editor}
    </section>
  );
}
