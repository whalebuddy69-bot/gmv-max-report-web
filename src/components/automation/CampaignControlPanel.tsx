import { useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CirclePause, CirclePlay, LockKeyhole, RefreshCw, Target } from "lucide-react";
import { fetchCampaignControlStatus, previewCampaignControl, type CampaignActionPreview, type CampaignControlAction } from "@/api/automationCampaign";
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

export function parseCampaignRoiTenths(text: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d))?$/.exec(text.trim());
  if (!match) return null;
  const tenths = Number(match[1]) * 10 + Number(match[2] ?? "0");
  return tenths > 0 && tenths <= 9999 ? tenths : null;
}

/** Read and review only; no confirmation or provider write is offered by this panel. */
export function CampaignControlPanel({ userId }: { userId: number }) {
  const heading = useId();
  const input = useId();
  const [action, setAction] = useState<CampaignControlAction | null>(null);
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<CampaignActionPreview | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const result = useQuery({
    queryKey: ["automation", "campaign-control", userId],
    queryFn: ({ signal }) => fetchCampaignControlStatus(signal),
    gcTime: 0, retry: false, staleTime: 0, refetchInterval: (query) => blockedRequest(query.state.error) ? false : 30_000,
  });
  const data = result.isSuccess ? result.data : null;
  const campaign = data?.campaign ?? null;
  const available = action === "SET_ROI" ? data?.capabilities.setRoi : action === "PAUSE" ? data?.capabilities.pause : data?.capabilities.resume;

  function choose(next: CampaignControlAction) {
    if (busy.current) return;
    setNotice(null); setPreview(null); setAction(next); setTarget("");
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !campaign || !action || !available || busy.current) return;
    const age = Date.now() - Date.parse(campaign.observedAt);
    if (age < -5_000 || age > 45_000) { setNotice("ข้อมูลหมดอายุ กรุณาอัปเดตสถานะแคมเปญก่อน"); return; }
    const requested = action === "SET_ROI" ? parseCampaignRoiTenths(target) : null;
    if (action === "SET_ROI" && (requested === null || requested === campaign.roiTargetTenths)) {
      setNotice("กรอก ROI Target ใหม่ 0.1–999.9 โดยใช้ทศนิยมไม่เกิน 1 ตำแหน่ง"); return;
    }
    busy.current = true; setPending(true); setNotice(null); setPreview(null);
    try {
      const next = await previewCampaignControl({ campaignId: campaign.campaignId, action, expectedStatus: campaign.operationStatus,
        expectedRoiTenths: campaign.roiTargetTenths, ...(requested !== null ? { targetRoiTenths: requested } : {}) });
      setPreview(next); setAction(null);
    } catch (error) {
      setNotice(error instanceof ApiError && error.status === 409 ? "แคมเปญหรือสิทธิ์เปลี่ยนระหว่างตรวจ กรุณาอัปเดตสถานะก่อน"
        : "ยังตรวจรายการไม่ได้ ไม่มีคำสั่งแก้ไขถูกส่งไป TikTok");
    } finally { busy.current = false; setPending(false); }
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
      {data.mode !== "disabled" && <Badge variant="outline">ตรวจเงื่อนไขเท่านั้น · ยังไม่แก้ TikTok</Badge>}
      {campaign && <p className="break-words text-sm">{campaign.campaignName || "แคมเปญ Ppan"} <span className="text-muted-foreground">· {displayStatus(campaign.operationStatus)} · ROI Target {roi(campaign.roiTargetTenths)}×</span></p>}
      {data.blocker && <p className="text-xs text-muted-foreground">{reasons.get(data.blocker) ?? "ยังยืนยันเงื่อนไขให้จัดการแคมเปญไม่ได้"}</p>}
      <div className="flex flex-wrap gap-1.5">
        {data.capabilities.setRoi && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => choose("SET_ROI")}><Target className="h-3.5 w-3.5" aria-hidden /> แก้ ROI Target</Button>}
        {data.capabilities.pause && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => choose("PAUSE")}><CirclePause className="h-3.5 w-3.5" aria-hidden /> พัก</Button>}
        {data.capabilities.resume && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => choose("RESUME")}><CirclePlay className="h-3.5 w-3.5" aria-hidden /> เปิดใหม่</Button>}
      </div>
      {action && <form className="space-y-2 rounded-md border border-border p-2.5 text-sm" onSubmit={(event) => void review(event)}>
        {action === "SET_ROI" ? <label className="flex flex-wrap items-center gap-2" htmlFor={input}>ROI Target ใหม่
          <Input id={input} className="w-24" type="text" inputMode="decimal" maxLength={5} value={target} disabled={pending} onChange={(event) => setTarget(event.target.value)} />
        </label> : <p>ตรวจเงื่อนไข{action === "PAUSE" ? "พัก" : "เปิดใหม่"}สำหรับแคมเปญนี้</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button type="submit" size="sm" disabled={pending || !available}>{pending ? "กำลังตรวจ…" : "ตรวจรายการ"}</Button>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setAction(null); setNotice(null); }}>ยกเลิก</Button>
        </div>
      </form>}
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      {preview && <div role="status" className="rounded-md bg-muted/50 px-3 py-2 text-xs">
        <p className="font-medium">ตรวจรายการผ่าน · ยังไม่ได้ส่งคำสั่งไป TikTok</p>
        <p className="mt-1 text-muted-foreground">{preview.action === "SET_ROI" ? `ROI Target ${roi(preview.before.roiTenths)}× → ${roi(preview.after.roiTenths)}×`
          : `${displayStatus(preview.before.status)} → ${displayStatus(preview.after.status)}`}</p>
      </div>}
    </>}
  </section>;
}
