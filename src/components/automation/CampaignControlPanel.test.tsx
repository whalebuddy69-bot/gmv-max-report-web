import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignControlStatusSchema, previewCampaignControl } from "@/api/automationCampaign";
import { http } from "@/api/client";
import { parseCampaignRoiTenths } from "./CampaignControlPanel";

afterEach(() => vi.restoreAllMocks());

describe("Ppan campaign action review", () => {
  const campaignId = "1234567890123456";
  const input = { campaignId, action: "PAUSE", expectedStatus: "ENABLE", expectedRoiTenths: 60 } as const;
  const preview = { campaignId, action: "PAUSE", sent: false, mode: "dry-run",
    before: { status: "ENABLE", roiTenths: 60 }, after: { status: "DISABLE", roiTenths: 60 } } as const;

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
});
