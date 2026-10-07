import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StoreSyncControls, syncHistoryOptions } from "./Stores";

describe("store sync history controls", () => {
  it("maps only explicit history choices to overrides", () => {
    expect(syncHistoryOptions("default")).toBeUndefined();
    expect(syncHistoryOptions("30-days")).toEqual({ lookbackDays: 30 });
    expect(syncHistoryOptions("previous-month")).toEqual({ initialHistory: true });
  });

  it("starts on the normal policy, offers both histories, and explains a new shop's default", () => {
    const html = renderToStaticMarkup(<StoreSyncControls isSyncing={false} hasSynced={false} onSync={() => {}} />);
    expect(html).toContain("ช่วงข้อมูลที่ต้องการ sync");
    expect(html).toContain('value="default" selected=""');
    expect(html).toContain("ย้อนหลัง 30 วัน");
    expect(html).toContain("ตั้งแต่วันที่ 1 เดือนก่อน");
    expect(html).toContain("Sync ครั้งแรก: ตั้งแต่วันที่ 1 เดือนก่อนถึงวันนี้");
    expect(html).toContain("sync ร้านนี้ใหม่");
    expect(html).not.toContain('disabled=""');
  });

  it("does not claim initial backfill for an existing shop", () => {
    const html = renderToStaticMarkup(<StoreSyncControls isSyncing={false} hasSynced onSync={() => {}} />);
    expect(html).toContain("อัปเดตช่วงล่าสุดตามรอบปกติ");
    expect(html).not.toContain("Sync ครั้งแรก");
  });

  it("disables the selector and action while the shop is syncing", () => {
    const html = renderToStaticMarkup(<StoreSyncControls isSyncing hasSynced onSync={() => {}} />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain("กำลัง sync…");
  });

  it("shows an accessible inline request error and removes it when cleared", () => {
    const html = renderToStaticMarkup(<StoreSyncControls isSyncing={false} hasSynced onSync={() => {}} error="ติดต่อ service ไม่ได้" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("เริ่ม sync ไม่สำเร็จ: ติดต่อ service ไม่ได้");
    expect(html).not.toContain('disabled=""');
    const cleared = renderToStaticMarkup(<StoreSyncControls isSyncing hasSynced onSync={() => {}} />);
    expect(cleared).not.toContain('role="alert"');
    expect(cleared).not.toContain("เริ่ม sync ไม่สำเร็จ");
  });
});
