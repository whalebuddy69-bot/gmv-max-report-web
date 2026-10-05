import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./analytics", () => ({ fetchAllDays: vi.fn(), fetchSummary: vi.fn() }));
import { fetchAllDays, fetchSummary } from "./analytics";
import { fetchOverallExport } from "./overallExport";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchAllDays).mockResolvedValue([]);
  vi.mocked(fetchSummary).mockResolvedValue({ current: { totalVideos: 15 } } as Awaited<ReturnType<typeof fetchSummary>>);
});

describe("fetchOverallExport", () => {
  it("uses only two calls for the entire range, matching the top cards' scope", async () => {
    const range = { from: "2026-10-01", to: "2026-10-10", storeIds: ["shop-1", "shop-2"], promotionType: "LIVE" as const, identityId: "creator-1", campaignId: "ignored-campaign", itemGroupId: "ignored-product" };
    const result = await fetchOverallExport(range);
    const scope = { from: range.from, to: range.to, storeIds: range.storeIds, promotionType: "LIVE", identityId: "creator-1" };
    expect(fetchAllDays).toHaveBeenCalledTimes(1);
    expect(fetchAllDays).toHaveBeenCalledWith(scope);
    expect(fetchSummary).toHaveBeenCalledTimes(1);
    expect(fetchSummary).toHaveBeenCalledWith(scope);
    expect(result).toMatchObject({ range: scope, days: [], totals: { totalVideos: 15 } });
  });
  it("does not send a stale LIVE identity for Product", async () => {
    await fetchOverallExport({ from: "2026-10-01", to: "2026-10-10", promotionType: "PRODUCT", identityId: "stale" });
    expect(vi.mocked(fetchAllDays).mock.calls[0]?.[0].identityId).toBeUndefined();
  });
  it("fails instead of exporting a fake zero report when either API fails", async () => {
    vi.mocked(fetchSummary).mockRejectedValueOnce(new Error("Summary unavailable"));
    await expect(fetchOverallExport({ from: "2026-10-01", to: "2026-10-10" })).rejects.toThrow("Summary unavailable");
  });
});
