import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
});
import { countActiveFilters, toRangeQuery, useFilterStore } from "./filterStore";
afterAll(() => vi.unstubAllGlobals());

describe("creative delivery filter scope", () => {
  beforeEach(() => useFilterStore.setState(useFilterStore.getInitialState(), true));

  it("is detail-only, not part of Overall or generic range requests", () => {
    useFilterStore.getState().setDeliveryStatus("LEARNING");
    const state = useFilterStore.getState();
    expect(state.deliveryStatus).toBe("LEARNING");
    expect(toRangeQuery(state)).not.toHaveProperty("deliveryStatus");
    expect(countActiveFilters(state)).toBe(1);
  });

  it("preserves the status when changing performance dates", () => {
    useFilterStore.getState().setDeliveryStatus("UNKNOWN");
    useFilterStore.getState().setDateRange("2026-09-01", "2026-09-30");
    expect(useFilterStore.getState().deliveryStatus).toBe("UNKNOWN");
  });

  it.each(["store", "promotion", "clear"])("clears status for %s transition", (transition) => {
    useFilterStore.getState().setDeliveryStatus("DELIVERING");
    if (transition === "store") useFilterStore.getState().setStoreIds(["another-store"]);
    if (transition === "promotion") useFilterStore.getState().setPromotionType("LIVE");
    if (transition === "clear") useFilterStore.getState().clearFilters();
    expect(useFilterStore.getState().deliveryStatus).toBeNull();
  });
});
