import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();

vi.mock("./client", () => ({
  http: { get: vi.fn() },
  request: (...args: unknown[]) => requestMock(...args),
}));

const { fetchAllCreatives, fetchCreatives, MAX_PAGE_SIZE } = await import("./analytics");
const { creativesResponseSchema } = await import("./schemas");

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
