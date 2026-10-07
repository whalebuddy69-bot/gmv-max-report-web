import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));

vi.mock("./client", () => ({
  http: { get: getMock, post: postMock },
  request: async (
    schema: { parse: (value: unknown) => unknown },
    _context: string,
    send: () => Promise<{ data: unknown }>,
  ) => schema.parse((await send()).data),
}));

import { fetchSyncStatus, startStoreSync, targetKey } from "./sync";

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset().mockResolvedValue({ data: { started: true } });
});

describe("per-shop sync history", () => {
  it("keeps the default request compatible and leaves the policy to the backend", async () => {
    expect(await startStoreSync("advertiser-1", "shop-1")).toBe(true);
    expect(postMock).toHaveBeenCalledWith("/sync/run", {
      advertiserId: "advertiser-1", storeId: "shop-1",
    });
  });

  it("sends a bounded 30-day override only for the selected store", async () => {
    await startStoreSync("advertiser-1", "shop-1", { lookbackDays: 30 });
    expect(postMock).toHaveBeenCalledWith("/sync/run", {
      advertiserId: "advertiser-1", storeId: "shop-1", lookbackDays: 30,
    });
  });

  it("requests prior-month history without calculating dates in the browser", async () => {
    await startStoreSync("advertiser-1", "shop-1", { initialHistory: true });
    expect(postMock).toHaveBeenCalledWith("/sync/run", {
      advertiserId: "advertiser-1", storeId: "shop-1", initialHistory: true,
    });
  });

  it("preserves the already-running result without hiding other failures", async () => {
    postMock.mockRejectedValueOnce(Object.assign(new Error("Already running"), { code: "SYNC_RUNNING" }));
    expect(await startStoreSync("advertiser-1", "shop-1", { lookbackDays: 30 })).toBe(false);
    postMock.mockRejectedValueOnce(new Error("Network failed"));
    await expect(startStoreSync("advertiser-1", "shop-1")).rejects.toThrow("Network failed");
  });

  it("retains status-response compatibility with older APIs", async () => {
    getMock.mockResolvedValueOnce({ data: { enabled: true, cron: "*/30 * * * *", running: false } });
    expect(await fetchSyncStatus()).toMatchObject({ runningTargets: [] });
    expect(targetKey("advertiser-1", "shop-1")).toBe("advertiser-1:shop-1");
  });
});
