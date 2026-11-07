import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PILOT_BUDGET_CLIENT_ID } from "@/api/automation";
import { budgetAutoStatusSchema, fetchBudgetAutoStatus, SRIHIW_CAP_CLIENT_ID, type BudgetAutoStatus } from "@/api/automationBudget";
import { http } from "@/api/client";
import { AutoBudgetStatusBody } from "./AutoBudgetStatusPanel";

const observedAt = "2026-03-06T01:00:00.000Z";
const now = Date.parse(observedAt) + 2_000;
const status = {
  clientId: PILOT_BUDGET_CLIENT_ID,
  mode: "shadow",
  grant: null,
  preview: {
    status: "WOULD_INCREASE", campaignId: "sample-campaign", currentBudgetMinor: 800_000,
    spendMinor: 650_000, thresholdMinor: 640_000, targetBudgetMinor: 960_000,
    projectedClientSpendMinor: 1_000_000, policyRevision: 2, observedAt,
  },
  blockers: ["NATIVE_AUTO_UNVERIFIED", "SPEND_WATERMARK_MISSING", "LIVE_DELIVERY_UNVERIFIED"],
} satisfies BudgetAutoStatus;

afterEach(() => vi.restoreAllMocks());

describe("read-only Auto budget panel", () => {
  it("labels the calculated proposal and blockers without any button or live claim", () => {
    const html = renderToStaticMarkup(<AutoBudgetStatusBody data={status} campaignId={status.preview.campaignId} now={now} />);
    expect(html).toContain("ประเมินอย่างเดียว · ไม่เพิ่มงบ");
    expect(html).toContain("฿6,400.00");
    expect(html).toContain("฿9,600.00");
    expect(html).toContain("฿10,000.00");
    expect(html).toContain("ไม่ใช่เวลาที่ TikTok อัปเดตยอดใช้");
    expect(html).toContain("ยังยืนยันไม่ได้ว่า Auto Budget ของ TikTok ปิดอยู่");
    expect(html).toContain("ยังยืนยันไม่ได้ว่ากำลังไลฟ์และแคมเปญกำลังส่งโฆษณา");
    expect(html).not.toContain("<button");
  });

  it("does not display old, future, or foreign campaign numbers", () => {
    for (const [campaignId, clock] of [["other-campaign", now], [null, now], [status.preview.campaignId, now + 181_000], [status.preview.campaignId, now - 8_000]] as const) {
      const html = renderToStaticMarkup(<AutoBudgetStatusBody data={status} campaignId={campaignId} now={clock} />);
      expect(html).toContain("ยังไม่มีผลประเมินล่าสุดของแคมเปญนี้");
      expect(html).not.toContain("฿9,600.00");
    }
  });

  it("rejects contradictory calculated amounts and doesn't leak unknown error labels", () => {
    expect(budgetAutoStatusSchema.safeParse(status).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...status, preview: { ...status.preview, targetBudgetMinor: 300 } }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...status, preview: { ...status.preview, projectedClientSpendMinor: 800_000 } }).success).toBe(false);
    const data = { ...status, mode: "disabled", preview: null, blockers: ["unknown-internal-tag"] } satisfies BudgetAutoStatus;
    const html = renderToStaticMarkup(<AutoBudgetStatusBody data={data} campaignId={null} now={now} />);
    expect(html).toContain("Auto ยังไม่เปิด");
    expect(html).toContain("มีเงื่อนไขความปลอดภัยที่ยังไม่ผ่าน");
    expect(html).not.toContain("unknown-internal-tag");
  });

  it("uses only scoped GET and rejects a response for another Creator", async () => {
    const srihiw = { ...status, clientId: SRIHIW_CAP_CLIENT_ID, mode: "disabled", preview: null };
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: status }).mockResolvedValueOnce({ data: srihiw }).mockResolvedValueOnce({ data: status });
    const post = vi.spyOn(http, "post");
    await expect(fetchBudgetAutoStatus(PILOT_BUDGET_CLIENT_ID)).resolves.toEqual(status);
    await expect(fetchBudgetAutoStatus(SRIHIW_CAP_CLIENT_ID)).resolves.toEqual(srihiw);
    await expect(fetchBudgetAutoStatus(SRIHIW_CAP_CLIENT_ID)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "/automation/budget/auto/status", "/automation/budget/srihiw/auto/status", "/automation/budget/srihiw/auto/status",
    ]);
    expect(post).not.toHaveBeenCalled();
  });
});
