import { RefreshCw } from "lucide-react";
import type { StoreOption } from "@/types/report";
import type { SyncStatus } from "@/api/sync";
import { Button } from "@/components/ui/button";
import { formatStatusCheckedAt } from "@/lib/creativeStatus";
import { cn } from "@/lib/utils";

export interface ReportFreshnessProps {
  stores: StoreOption[];
  selectedStoreIds: string[];
  loadedAt: number | null;
  isFetching: boolean;
  error?: string | null;
  onRefresh: () => void;
  syncStatus?: SyncStatus;
}

function validTimestamp(value: string | null | undefined): number | null {
  if (!value || formatStatusCheckedAt(value) === null) return null;
  return new Date(value).getTime();
}

function timeLabel(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatStatusCheckedAt(date.toISOString()) : null;
}

/** An absent selection means all stores. Missing metadata is never treated as fresh. */
export function selectedStoreFreshness(stores: readonly StoreOption[], selectedStoreIds: readonly string[]) {
  const ids = [...new Set(selectedStoreIds.length ? selectedStoreIds : stores.map((store) => store.storeId))];
  let missingCount = 0;
  let disabledCount = 0;
  const successfulTimes: number[] = [];
  for (const storeId of ids) {
    const matches = stores.filter((store) => store.storeId === storeId);
    const times = matches.map((store) => validTimestamp(store.lastSyncedAt));
    // A shop may have more than one advertiser target. Retain the oldest known
    // successful time and disclose if any selected target lacks a timestamp.
    if (!matches.length || times.some((time) => time === null)) missingCount += 1;
    if (matches.length && matches.every((store) => !store.enabled)) disabledCount += 1;
    successfulTimes.push(...times.filter((time): time is number => time !== null));
  }
  return {
    totalCount: ids.length,
    missingCount,
    disabledCount,
    oldestSuccessfulAt: successfulTimes.length ? Math.min(...successfulTimes) : null,
  };
}

export function schedulerDescription(syncStatus?: SyncStatus): string {
  if (!syncStatus) return "รอบซิงก์ TikTok: ยังตรวจสอบการตั้งค่าไม่ได้";
  if (!syncStatus.enabled) return "รอบซิงก์ TikTok: ปิดการซิงก์อัตโนมัติ";
  if (syncStatus.cron === "0 * * * *") return "รอบซิงก์ TikTok: ทุกชั่วโมงตามเวลาที่ระบบตั้งไว้";
  return "รอบซิงก์ TikTok: เปิดใช้งานตามตารางที่ระบบตั้งไว้";
}

/** Pure presentation: refreshing reads saved data through the parent's handler. */
export function ReportFreshness({ stores, selectedStoreIds, loadedAt, isFetching, error, onRefresh, syncStatus }: ReportFreshnessProps) {
  const freshness = selectedStoreFreshness(stores, selectedStoreIds);
  const oldestSync = timeLabel(freshness.oldestSuccessfulAt);
  const pageRead = timeLabel(loadedAt);
  const selectedStores = selectedStoreIds.length ? stores.filter((store) => selectedStoreIds.includes(store.storeId)) : stores;
  const selectedTargetSyncing = selectedStores.some((store) => syncStatus?.runningTargets.includes(`${store.advertiserId}:${store.storeId}`));
  const syncRunning = syncStatus?.running || selectedTargetSyncing;

  return (
    <section className="rounded-lg border border-border bg-muted/20 px-4 py-3" aria-label="ความสดใหม่ของข้อมูล">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">ข้อมูลที่ระบบบันทึกไว้ ไม่ใช่ realtime จาก TikTok</p>
          <p>หน้านี้อ่านจากฐานข้อมูลล่าสุด: <span className="tabular">{pageRead ?? "ยังไม่ทราบเวลา"}</span></p>
          <p>
            {freshness.totalCount > 1 ? `ซิงก์ร้านค้าสำเร็จล่าสุด — เวลาเก่าสุดใน ${freshness.totalCount} ร้านที่เลือก` : "ซิงก์ร้านค้าสำเร็จล่าสุด"}: {" "}
            <span className="tabular">{oldestSync ?? "ยังไม่มีเวลาซิงก์ที่ยืนยันได้"}</span>
          </p>
          {freshness.missingCount > 0 && <p className="text-amber-800">ยังไม่มีเวลาซิงก์ที่ยืนยันได้ {freshness.missingCount} ร้าน — ไม่ถือว่าทุกร้านอัปเดตแล้ว</p>}
          {freshness.totalCount === 0 && <p>ยังไม่มีข้อมูลร้านค้าที่ใช้ตรวจสอบเวลาซิงก์</p>}
          <p>{schedulerDescription(syncStatus)}{syncRunning ? " · มีงานซิงก์กำลังทำงาน ผลยังไม่ยืนยันจนกว่าจะสำเร็จ" : ""}</p>
          {freshness.disabledCount > 0 && <p>ร้านที่เลือกปิดการซิงก์อัตโนมัติ {freshness.disabledCount} ร้าน</p>}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={isFetching} aria-busy={isFetching}>
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} aria-hidden />
          รีเฟรชข้อมูลที่บันทึกไว้
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">ปุ่มนี้อ่านข้อมูลที่บันทึกแล้ว ไม่ได้สั่งดึง TikTok ใหม่ · Status checked at ของแต่ละแถวอาจเก่ากว่าเวลาซิงก์ร้าน และไม่ใช่เวลาที่ TikTok เปลี่ยนสถานะ</p>
      <p className="mt-1 text-xs text-muted-foreground">เวลาแสดงเป็น Asia/Bangkok (+07:00) · หน้านี้ไม่ได้เพิ่มรอบดึงข้อมูลจาก TikTok</p>
      {isFetching && <p role="status" className="mt-2 text-xs text-muted-foreground">กำลังอ่านข้อมูลที่บันทึกไว้…</p>}
      {error && <p role="alert" className="mt-2 break-words text-xs text-destructive">รีเฟรชไม่สำเร็จ: {error} · เวลาที่แสดงยังเป็นข้อมูลสำเร็จครั้งก่อน</p>}
    </section>
  );
}
