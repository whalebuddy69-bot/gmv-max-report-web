import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ReportFreshness, schedulerDescription, selectedStoreFreshness } from "./ReportFreshness";
import { Button } from "@/components/ui/button";
import type { StoreOption } from "@/types/report";

const store = (storeId: string, lastSyncedAt: string | null, enabled = true): StoreOption => ({
  storeId, storeName: storeId, advertiserId: "advertiser", enabled, lastSyncedAt, firstDate: "2026-10-01", lastDate: "2026-10-07",
});
const stores = [store("shop-a", "2026-10-07T01:00:00Z"), store("shop-b", "2026-10-07T00:00:00Z"), store("shop-c", null)];
const syncStatus = { enabled: true, cron: "0 * * * *", running: false, runningTargets: [] };

describe("selected store freshness", () => {
  it("shows the oldest successful sync across all stores and discloses missing timestamps", () => {
    expect(selectedStoreFreshness(stores, [])).toEqual({
      totalCount: 3, missingCount: 1, disabledCount: 0, oldestSuccessfulAt: Date.parse("2026-10-07T00:00:00Z"),
    });
  });

  it("uses only the selected scope, deduplicates selected IDs, and counts absent metadata", () => {
    expect(selectedStoreFreshness(stores, ["shop-a", "shop-a", "missing"])).toEqual({
      totalCount: 2, missingCount: 1, disabledCount: 0, oldestSuccessfulAt: Date.parse("2026-10-07T01:00:00Z"),
    });
  });

  it("does not treat invalid or missing store sync times as fresh", () => {
    expect(selectedStoreFreshness([store("bad", "yesterday", false), store("never", null)], [])).toEqual({
      totalCount: 2, missingCount: 2, disabledCount: 1, oldestSuccessfulAt: null,
    });
    expect(selectedStoreFreshness([], [])).toEqual({ totalCount: 0, missingCount: 0, disabledCount: 0, oldestSuccessfulAt: null });
  });

  it("does not conceal missing advertiser-target timestamps within one shop", () => {
    expect(selectedStoreFreshness([store("shop-a", "2026-10-07T01:00:00Z"), { ...store("shop-a", null), advertiserId: "second" }], [])).toMatchObject({ totalCount: 1, missingCount: 1 });
  });
});

describe("scheduler description", () => {
  it("only promises hourly sync for the exact enabled hourly schedule", () => {
    expect(schedulerDescription(syncStatus)).toContain("ทุกชั่วโมง");
    expect(schedulerDescription({ ...syncStatus, cron: "*/30 * * * *" })).not.toContain("ทุกชั่วโมง");
    expect(schedulerDescription({ ...syncStatus, cron: " 0 * * * * " })).not.toContain("ทุกชั่วโมง");
    expect(schedulerDescription({ ...syncStatus, enabled: false })).toContain("ปิดการซิงก์อัตโนมัติ");
    expect(schedulerDescription()).toContain("ยังตรวจสอบการตั้งค่าไม่ได้");
  });
});

describe("ReportFreshness", () => {
  const props = { stores, selectedStoreIds: [], loadedAt: Date.parse("2026-10-07T02:30:00Z"), isFetching: false, onRefresh: () => {}, syncStatus };

  it("clearly separates reading saved data from the oldest successful shop sync", () => {
    const html = renderToStaticMarkup(<ReportFreshness {...props} />);
    expect(html).toContain("หน้านี้อ่านจากฐานข้อมูลล่าสุด");
    expect(html).toContain("2026-10-07 09:30:00 +07:00");
    expect(html).toContain("เวลาเก่าสุดใน 3 ร้านที่เลือก");
    expect(html).toContain("2026-10-07 07:00:00 +07:00");
    expect(html).toContain("ยังไม่มีเวลาซิงก์ที่ยืนยันได้ 1 ร้าน");
    expect(html).toContain("ไม่ถือว่าทุกร้านอัปเดตแล้ว");
    expect(html).toContain("ไม่ได้สั่งดึง TikTok ใหม่");
    expect(html).toContain("Status checked at ของแต่ละแถวอาจเก่ากว่า");
    expect(html).toContain("ไม่ใช่เวลาที่ TikTok เปลี่ยนสถานะ");
    expect(html).toContain("หน้านี้ไม่ได้เพิ่มรอบดึงข้อมูลจาก TikTok");
  });

  it("disables the refresh button during a read and announces errors without fabricating new timestamps", () => {
    const html = renderToStaticMarkup(<ReportFreshness {...props} isFetching error="network unavailable" />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("เวลาที่แสดงยังเป็นข้อมูลสำเร็จครั้งก่อน");
  });

  it("passes only the provided manual handler to the button, without invoking it on render", () => {
    const onRefresh = vi.fn();
    const root = ReportFreshness({ ...props, onRefresh });
    const findButton = (node: ReactElement): ReactElement<{ onClick: () => void }> | undefined => {
      if (node.type === Button) return node as ReactElement<{ onClick: () => void }>;
      const children = node.props.children;
      return (Array.isArray(children) ? children.flat(Infinity) : [children])
        .filter((child): child is ReactElement => Boolean(child && typeof child === "object" && "type" in child))
        .map(findButton).find(Boolean);
    };
    const button = findButton(root);
    expect(button).toBeDefined();
    expect(onRefresh).not.toHaveBeenCalled();
    button?.props.onClick();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows no invented freshness for an empty scope or invalid loadedAt", () => {
    const html = renderToStaticMarkup(<ReportFreshness {...props} stores={[]} loadedAt={Number.NaN} syncStatus={undefined} />);
    expect(html).toContain("ยังไม่ทราบเวลา");
    expect(html).toContain("ยังไม่มีข้อมูลร้านค้า");
    expect(html).toContain("ยังตรวจสอบการตั้งค่าไม่ได้");
  });

  it("shows selected shops disabled for automatic sync and active manual work separately", () => {
    const html = renderToStaticMarkup(<ReportFreshness {...props} stores={[store("shop-a", null, false)]} selectedStoreIds={["shop-a"]} syncStatus={{ ...syncStatus, enabled: false, runningTargets: ["advertiser:shop-a"] }} />);
    expect(html).toContain("ปิดการซิงก์อัตโนมัติ");
    expect(html).toContain("ร้านที่เลือกปิดการซิงก์อัตโนมัติ 1 ร้าน");
    expect(html).toContain("มีงานซิงก์กำลังทำงาน");
    expect(html).toContain("ผลยังไม่ยืนยันจนกว่าจะสำเร็จ");
  });
});
