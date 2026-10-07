import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliveryStatusPanel } from "./DeliveryStatusPanel";
import { DELIVERY_STATUS_CATALOG } from "@/lib/creativeStatus";

describe("DeliveryStatusPanel", () => {
  it("shows all nine filter states, including zeros, and two explicit fallbacks", () => {
    const html = renderToStaticMarkup(<DeliveryStatusPanel value={null} onChange={() => {}} counts={{ DELIVERING: 250, LEARNING: 20, UNKNOWN: 5, OTHER: 2 }} />);
    expect(html).toContain("ทุกสถานะ (277)");
    for (const status of DELIVERY_STATUS_CATALOG) {
      expect(html).toContain(`value="${status.value}"`);
      expect(html).toContain(status.meaning);
    }
    expect(html).toContain('value="UNKNOWN"');
    expect(html).toContain('value="OTHER"');
    expect(html).toContain("Rejected · ไม่ผ่านการตรวจสอบ (0)");
    expect(html).toContain("แถวชิ้นงาน ไม่ใช่วิดีโอไม่ซ้ำ");
    expect(html).toContain("ไม่เปลี่ยน Overall");
    expect(html).toContain("ไม่ใช่ Exploration / Outstanding");
    expect(html).not.toContain('disabled=""');
  });

  it("reflects the parent-selected server-side filter", () => {
    const html = renderToStaticMarkup(<DeliveryStatusPanel value="LEARNING" onChange={() => {}} counts={{ LEARNING: 9 }} />);
    expect(html).toContain('value="LEARNING" selected=""');
    expect(html).toContain("ทุกสถานะ (9)");
  });

  it("shows unavailable counts, not zero, and disables filtering for an older API", () => {
    const html = renderToStaticMarkup(<DeliveryStatusPanel value={null} onChange={() => {}} counts={null} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain("ทุกสถานะ (—)");
    expect(html).toContain("Learning · กำลังเรียนรู้ (—)");
    expect(html).toContain("ยังใช้ตัวกรองไม่ได้");
    expect(html).not.toContain("(0)");
  });

  it("announces loading without presenting missing counts as an empty result", () => {
    const html = renderToStaticMarkup(<DeliveryStatusPanel value="DELIVERING" onChange={() => {}} counts={null} isFetching disabled />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("กำลังตรวจสอบจำนวนสถานะ");
    expect(html).toContain('disabled=""');
  });

  it("keeps the full state legend collapsible and separately explains fallback states", () => {
    const html = renderToStaticMarkup(<DeliveryStatusPanel value={null} onChange={() => {}} counts={{}} disabled />);
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("ความหมายของทั้ง 9 สถานะ");
    expect(html).toContain("Unknown คือ API ไม่ส่งสถานะ");
    expect(html).toContain("ไม่ได้รับประกันผลลัพธ์เมื่อเพิ่มงบ");
    expect(html).toContain('disabled=""');
  });
});
