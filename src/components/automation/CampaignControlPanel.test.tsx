import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignControlStatusSchema, confirmCampaignControl, isConfirmableCampaignPreview, previewCampaignControl, readCampaignOperation } from "@/api/automationCampaign";
import { http } from "@/api/client";
import { CampaignControlPanel, parseCampaignRoiTenths } from "./CampaignControlPanel";

afterEach(() => vi.restoreAllMocks());

describe("Ppan campaign action review", () => {
  const campaignId = "1234567890123456";
  const input = { campaignId, action: "PAUSE", expectedStatus: "ENABLE", expectedRoiTenths: 60 } as const;
  const preview = { campaignId, action: "PAUSE", sent: false, mode: "dry-run",
    before: { status: "ENABLE", roiTenths: 60 }, after: { status: "DISABLE", roiTenths: 60 } } as const;
  const observedAt = new Date().toISOString();
  const status = { clientId: "punpan_020", mode: "dry-run", blocker: null,
    campaign: { campaignId, campaignName: "sample", operationStatus: "ENABLE", roiTargetTenths: 62, observedAt },
    capabilities: { setRoi: true, pause: true, resume: false, create: false } } as const;

  function renderRoiField(actionsEnabled: boolean, syncedCampaignId?: string | null, supplied: unknown = status) {
    const client = new QueryClient();
    client.setQueryData(["automation", "campaign-control", 7], campaignControlStatusSchema.parse(supplied));
    const result = renderToStaticMarkup(<QueryClientProvider client={client}>
      <CampaignControlPanel layout="roi-field" userId={7} fallbackRoi={5.8} actionsEnabled={actionsEnabled} syncedCampaignId={syncedCampaignId} />
    </QueryClientProvider>);
    client.clear();
    return result;
  }

  it("shows the selected campaign's known ROI as a multiplier and keeps it read-only until exact Sync", () => {
    const beforeSync = renderRoiField(false, undefined);
    expect(beforeSync).toContain("LIVE ROI Target");
    expect(beforeSync).toContain("×");
    expect(beforeSync).not.toContain("THB");
    expect(beforeSync).toContain('readonly=""');
    expect(beforeSync).toContain('value="5.8"');
    expect(beforeSync).not.toContain("ตรวจ ROI");
    const unmatched = renderRoiField(true, "2234567890123456");
    expect(unmatched).toContain('readonly=""');
    expect(unmatched).toContain('value="5.8"');
    const exact = renderRoiField(true, campaignId);
    expect(exact).not.toContain('readonly=""');
    expect(exact).toContain('value="6.2"');
    expect(exact).toContain("ตรวจ ROI");
    expect(exact).toContain("ยังไม่ส่งคำสั่งไป TikTok");
  });

  it("can review resuming the matched paused campaign without making its ROI writable", () => {
    const paused = renderRoiField(true, null, { ...status,
      campaign: { ...status.campaign, operationStatus: "DISABLE" },
      capabilities: { ...status.capabilities, pause: false, resume: true } });
    expect(paused).toContain('readonly=""');
    expect(paused).toContain("เปิดแคมเปญเดิมอีกครั้ง");
    expect(paused).not.toContain('value="6.2"');
  });

  it("converts decimal ROI values without floating rounding or unexpected inputs", () => {
    expect(parseCampaignRoiTenths("2.3")).toBe(23);
    expect(parseCampaignRoiTenths(" 18 ")).toBe(180);
    expect(parseCampaignRoiTenths("999.9")).toBe(9999);
    for (const value of ["0", "-1", "1e2", "1000", "1.02", "1.", "1,2", "Infinity"]) expect(parseCampaignRoiTenths(value)).toBeNull();
  });

  it("rejects out-of-scope and contradictory action capabilities", () => {
    const status = { clientId: "punpan_020", mode: "dry-run", blocker: null,
      campaign: { campaignId, campaignName: "sample", operationStatus: "ENABLE", roiTargetTenths: 60, observedAt: "2026-03-06T00:00:00.000Z" },
      capabilities: { setRoi: true, pause: true, resume: false, create: false } };
    expect(campaignControlStatusSchema.safeParse(status).success).toBe(true);
    expect(campaignControlStatusSchema.safeParse({ ...status, clientId: "srihiw" }).success).toBe(false);
    expect(campaignControlStatusSchema.safeParse({ ...status, mode: "disabled" }).success).toBe(false);
    expect(campaignControlStatusSchema.safeParse({ ...status, capabilities: { ...status.capabilities, resume: true } }).success).toBe(false);
  });

  it("only calls the exact review path and rejects results that would misstate the action", async () => {
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: preview })
      .mockResolvedValueOnce({ data: { ...preview, campaignId: "2234567890123456" } })
      .mockResolvedValueOnce({ data: { ...preview, sent: true } });
    await expect(previewCampaignControl(input)).resolves.toEqual(preview);
    await expect(previewCampaignControl(input)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    await expect(previewCampaignControl(input)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    await expect(previewCampaignControl({ ...input, expectedStatus: "DISABLE" })).rejects.toThrow();
    await expect(previewCampaignControl({ ...input, targetRoiTenths: 7 })).rejects.toThrow();
    expect(post.mock.calls).toEqual(Array.from({ length: 3 }, () => ["/automation/campaign/preview", input]));
  });

  it("keeps a matching ROI dry run in preview and rejects a response that changes delivery status", async () => {
    const roiInput = { ...input, action: "SET_ROI", targetRoiTenths: 72 } as const;
    const dryRun = { ...preview, action: "SET_ROI", after: { status: "ENABLE", roiTenths: 72 } } as const;
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: dryRun })
      .mockResolvedValueOnce({ data: { ...dryRun, after: { ...dryRun.after, status: "DISABLE" } } });
    const reviewed = await previewCampaignControl(roiInput);
    expect(reviewed).toEqual(dryRun);
    await expect(confirmCampaignControl(reviewed)).rejects.toThrow();
    await expect(previewCampaignControl(roiInput)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(post.mock.calls).toEqual(Array.from({ length: 2 }, () => ["/automation/campaign/preview", roiInput]));
  });

  it("never confirms a dry run, expired permit, or unexpected permit lifetime", async () => {
    const post = vi.spyOn(http, "post");
    const review = { ...preview, mode: "live" as const, operationId: "11111111-1111-4111-8111-111111111111",
      expiresAt: new Date(Date.now() - 1000).toISOString() };
    expect(isConfirmableCampaignPreview(review)).toBe(false);
    await expect(confirmCampaignControl(preview)).rejects.toThrow();
    await expect(confirmCampaignControl(review)).rejects.toThrow();
    await expect(confirmCampaignControl({ ...review, expiresAt: new Date(Date.now() + 240_000).toISOString() })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  it("sends only the confirmed operation ID and recovers the same operation read-only", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    const review = { ...preview, mode: "live" as const, operationId, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const output = { operationId, campaignId, action: "PAUSE", status: "APPLIED_VERIFIED", sent: true } as const;
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { ...output, sent: false } }).mockResolvedValueOnce({ data: output });
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: { ...output, campaignId: "2234567890123456" } })
      .mockResolvedValueOnce({ data: output });
    await expect(confirmCampaignControl(review)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    await expect(confirmCampaignControl(review)).resolves.toEqual(output);
    await expect(readCampaignOperation(operationId, review)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    await expect(readCampaignOperation(operationId, review)).resolves.toEqual(output);
    await expect(readCampaignOperation("../../outside")).rejects.toThrow();
    expect(post.mock.calls).toEqual(Array.from({ length: 2 }, () => ["/automation/campaign/confirm", { operationId, confirmed: true }]));
    expect(get.mock.calls).toEqual(Array.from({ length: 2 }, () => [`/automation/campaign/operations/${operationId}`]));
  });
});
