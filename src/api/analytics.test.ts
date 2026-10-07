import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();
const httpGetMock = vi.fn();

vi.mock("./client", () => ({
  http: { get: (...args: unknown[]) => httpGetMock(...args) },
  request: (...args: unknown[]) => requestMock(...args),
}));

const { fetchAllCreatives, fetchCreatives, MAX_PAGE_SIZE } = await import("./analytics");
const { creativeStatusCountsSchema, creativesResponseSchema } = await import("./schemas");
const { DELIVERY_STATUS_CATALOG } = await import("@/lib/creativeStatus");

function completeCounts(overrides: Record<string, number> = {}): Record<string, number> {
  return { ...Object.fromEntries(DELIVERY_STATUS_CATALOG.map((status) => [status.value, 0])), UNKNOWN: 0, OTHER: 0, ...overrides };
}

/** One wire-shaped creative row; only the id varies. */
function wireRow(n: number) {
  return {
    store_id: "store-1",
    campaign_id: "camp-1",
    item_group_id: "prod-1",
    item_id: `item-${n}`,
    campaign_name: "Campaign",
    title: null,
    tt_account_name: null,
    authorization_type: null,
    shop_content_type: "VIDEO" as const,
    creative_delivery_status: null,
    cost: 1,
    orders: 0,
    gross_revenue: 0,
    roi: null,
    product_impressions: 0,
    product_clicks: 0,
    product_click_rate: null,
  };
}

beforeEach(() => {
  requestMock.mockReset();
  httpGetMock.mockReset();
});

describe("delivery status counts and query contract", () => {
  it("accepts all eleven complete integer counts including genuine zero", () => {
    const counts = completeCounts({ IN_QUEUE: 7, UNKNOWN: 2, OTHER: 1 });
    expect(creativeStatusCountsSchema.parse(counts)).toEqual(counts);
    expect(creativeStatusCountsSchema.parse(completeCounts())).toEqual(completeCounts());
  });

  it.each([
    undefined, null, {}, { LEARNING: 5 }, [], "5",
    completeCounts({ LEARNING: -1 }), completeCounts({ LEARNING: 1.5 }),
    completeCounts({ LEARNING: Infinity }), completeCounts({ LEARNING: NaN }),
    { ...completeCounts(), LEARNING: "5" }, { ...completeCounts(), OTHER: undefined },
    { ...completeCounts(), FUTURE: 1 },
  ])("keeps malformed/legacy counts unknown instead of inventing zeros: %j", (counts) => {
    expect(creativeStatusCountsSchema.parse(counts)).toBeNull();
  });

  it("sends status alongside the existing scope and maps server counts without counting page rows", async () => {
    const statusCounts = completeCounts({ LEARNING: 10, DELIVERING: 100 });
    requestMock.mockImplementation(async (_schema, _path, execute) => {
      await execute();
      return creativesResponseSchema.parse({ creatives: [wireRow(1)], total: 10, statusCounts, limit: 1, offset: 2 });
    });
    const result = await fetchCreatives({ from: "2026-10-01", to: "2026-10-07", storeIds: ["one", "two"], campaignId: "campaign", itemGroupId: "product", contentType: "VIDEO", accountName: "creator", deliveryStatus: "LEARNING", limit: 1, offset: 2, sort: "grossRevenue", direction: "desc" });
    expect(httpGetMock).toHaveBeenCalledWith("/analytics/creatives", { params: {
      from: "2026-10-01", to: "2026-10-07", storeId: "one,two", campaignId: "campaign", itemGroupId: "product", contentType: "VIDEO", accountName: "creator", deliveryStatus: "LEARNING", limit: "1", offset: "2", sort: "gross_revenue", direction: "DESC",
    } });
    expect(result.statusCounts).toEqual(statusCounts);
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(10);
  });

  it("leaves unfiltered legacy reports usable with null counts", async () => {
    requestMock.mockImplementation(async (_schema, _path, execute) => {
      await execute();
      return creativesResponseSchema.parse({ creatives: [wireRow(1)], total: 1, limit: 100, offset: 0 });
    });
    const result = await fetchCreatives({ from: "2026-10-01", to: "2026-10-07" });
    expect(result.statusCounts).toBeNull();
    expect(result.rows).toHaveLength(1);
    expect(httpGetMock.mock.calls[0]?.[1].params).not.toHaveProperty("deliveryStatus");
    expect((await fetchAllCreatives({ from: "2026-10-01", to: "2026-10-07" })).statusCounts).toBeNull();
  });

  it.each([undefined, { LEARNING: 1 }, completeCounts({ OTHER: -1 })])("refuses filtered table/export when counts support cannot be verified: %j", async (statusCounts) => {
    requestMock.mockResolvedValue(creativesResponseSchema.parse({ creatives: [wireRow(1)], total: 1, limit: 100, offset: 0, statusCounts }));
    const query = { from: "2026-10-01", to: "2026-10-07", deliveryStatus: "LEARNING" as const };
    await expect(fetchCreatives(query)).rejects.toThrow("API ยังไม่รองรับการกรอง Delivery status");
    await expect(fetchAllCreatives(query)).rejects.toThrow("API ยังไม่รองรับการกรอง Delivery status");
  });

  it("forwards the selected status on every export page and returns whole-scope server counts", async () => {
    const statusCounts = completeCounts({ IN_QUEUE: 1001, DELIVERING: 4000 });
    requestMock.mockImplementation(async (_schema, _path, execute) => {
      await execute();
      const offset = Number(httpGetMock.mock.calls.at(-1)?.[1].params.offset);
      const rows = Array.from({ length: Math.min(MAX_PAGE_SIZE, 1001 - offset) }, (_, i) => wireRow(offset + i));
      return creativesResponseSchema.parse({ creatives: rows, total: 1001, statusCounts, limit: MAX_PAGE_SIZE, offset });
    });
    const result = await fetchAllCreatives({ from: "2026-10-01", to: "2026-10-07", deliveryStatus: "IN_QUEUE" });
    expect(result.rows).toHaveLength(1001);
    expect(result.statusCounts).toEqual(statusCounts);
    expect(httpGetMock.mock.calls.map((call) => call[1].params.deliveryStatus)).toEqual(["IN_QUEUE", "IN_QUEUE"]);
    expect(httpGetMock.mock.calls.map((call) => call[1].params.offset)).toEqual(["0", "1000"]);
  });

  it("aborts export if a later page stops supporting the status filter", async () => {
    requestMock.mockResolvedValueOnce(creativesResponseSchema.parse({ creatives: Array.from({ length: MAX_PAGE_SIZE }, (_, i) => wireRow(i)), total: 1001, statusCounts: completeCounts({ LEARNING: 1001 }), limit: MAX_PAGE_SIZE, offset: 0 }));
    requestMock.mockResolvedValueOnce(creativesResponseSchema.parse({ creatives: [wireRow(1000)], total: 1001, limit: MAX_PAGE_SIZE, offset: 1000 }));
    await expect(fetchAllCreatives({ from: "2026-10-01", to: "2026-10-07", deliveryStatus: "LEARNING" })).rejects.toThrow("API ยังไม่รองรับการกรอง Delivery status");
  });
});

/** Serves pages against a fixed row count */
async function collect(total: number, hardLimit?: number) {
  const seenOffsets: number[] = [];
  requestMock.mockImplementation(async () => {
    const offset = seenOffsets.length * MAX_PAGE_SIZE;
    seenOffsets.push(offset);
    if (seenOffsets.length > 100) throw new Error("runaway paging");
    const rows = [];
    for (let i = offset; i < Math.min(offset + MAX_PAGE_SIZE, total); i += 1) rows.push(wireRow(i));
    return { creatives: rows, total, limit: MAX_PAGE_SIZE, offset };
  });

  const result = await fetchAllCreatives(
    { from: "2026-08-01", to: "2026-08-31" },
    hardLimit === undefined ? {} : { hardLimit },
  );
  return { result, calls: seenOffsets.length, offsets: seenOffsets };
}

describe("fetchAllCreatives", () => {
  it("maps new status provenance while old/invalid provenance remains unknown", async () => {
    const wire = {
      creatives: [
        { ...wireRow(1), creative_delivery_status: "LEARNING", creative_delivery_status_checked_at: "2026-10-07T01:00:00Z", creative_delivery_status_stat_date: "2026-10-06" },
        wireRow(2),
        { ...wireRow(3), creative_delivery_status: "DELIVERING", creative_delivery_status_checked_at: "not-a-time", creative_delivery_status_stat_date: "2026-02-30" },
        { ...wireRow(4), creative_delivery_status: null, creative_delivery_status_checked_at: "2026-10-07T01:00:00Z", creative_delivery_status_stat_date: "2026-10-07" },
      ], total: 4, limit: 100, offset: 0,
    };
    requestMock.mockResolvedValue(creativesResponseSchema.parse(wire));
    const result = await fetchCreatives({ from: "2026-09-22", to: "2026-09-23" });
    expect(result.rows[0]).toMatchObject({ creativeDeliveryStatus: "LEARNING", creativeDeliveryStatusCheckedAt: "2026-10-07T01:00:00Z", creativeDeliveryStatusStatDate: "2026-10-06" });
    expect(result.rows[1]).toMatchObject({ creativeDeliveryStatusCheckedAt: null, creativeDeliveryStatusStatDate: null });
    expect(result.rows[2]).toMatchObject({ creativeDeliveryStatus: "DELIVERING", creativeDeliveryStatusCheckedAt: null, creativeDeliveryStatusStatDate: null });
    expect(result.rows[3]).toMatchObject({ creativeDeliveryStatus: null, creativeDeliveryStatusStatDate: "2026-10-07" });
  });
  it("maps both creator fields and accepts older responses without username", async () => {
    const wire = { creatives: [{ ...wireRow(1), tt_account_name: "Display", tt_account_username: "real.handle" }, wireRow(2)], total: 2, limit: 100, offset: 0 };
    requestMock.mockResolvedValue(creativesResponseSchema.parse(wire));
    const result = await fetchCreatives({ from: "2026-09-22", to: "2026-10-02" });
    expect(result.rows[0]).toMatchObject({ ttAccountName: "Display", ttAccountUsername: "real.handle" });
    expect(result.rows[1]?.ttAccountUsername).toBeNull();
  });
  it("makes a single request when everything fits in one page", async () => {
    const { result, calls } = await collect(400);
    expect(calls).toBe(1);
    expect(result.rows).toHaveLength(400);
    expect(result.total).toBe(400);
  });

  it("walks offset until every row is collected", async () => {
    const { result, calls, offsets } = await collect(2713);
    expect(calls).toBe(3);
    expect(offsets).toEqual([0, 1000, 2000]);
    expect(result.rows).toHaveLength(2713);
  });

  it("does not make an extra empty request when the total is an exact multiple", async () => {
    const { result, calls } = await collect(2000);
    expect(calls).toBe(2);
    expect(result.rows).toHaveLength(2000);
  });

  it("stops at the hard limit and still reports the true total", async () => {
    const { result, calls } = await collect(10_000, 2500);
    expect(result.rows).toHaveLength(2500);
    // The caller needs the real figure to tell the user the file is partial.
    expect(result.total).toBe(10_000);
    expect(calls).toBeLessThanOrEqual(3);
  });

  it("gives up after one extra request when the service ignores offset", async () => {
    let call = 0;
    requestMock.mockImplementation(async () => {
      call += 1;
      if (call > 50) throw new Error("runaway paging");
      // Always the same first page, and never enough to reach `total`.
      return { creatives: [wireRow(0)], total: 5000, limit: MAX_PAGE_SIZE, offset: 0 };
    });

    const result = await fetchAllCreatives({ from: "2026-08-01", to: "2026-08-31" }, { hardLimit: 5000 });
    // One priming request, then a single loop iteration that sees a page shorter than the limit
    // and concludes there is no more data
    expect(call).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it("reports progress as pages arrive", async () => {
    const seen: [number, number][] = [];
    let offset = 0;
    requestMock.mockImplementation(async () => {
      const rows = [];
      for (let i = offset; i < Math.min(offset + MAX_PAGE_SIZE, 2500); i += 1) rows.push(wireRow(i));
      offset += MAX_PAGE_SIZE;
      return { creatives: rows, total: 2500, limit: MAX_PAGE_SIZE, offset: 0 };
    });

    await fetchAllCreatives(
      { from: "2026-08-01", to: "2026-08-31" },
      { onProgress: (fetched, total) => seen.push([fetched, total]) },
    );

    expect(seen[0]).toEqual([1000, 2500]);
    expect(seen.at(-1)).toEqual([2500, 2500]);
  });
});
