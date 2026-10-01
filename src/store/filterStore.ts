import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PromotionType, RangeQuery, ShopContentType } from "@/types/report";
import { daysAgo, toIsoDate } from "@/lib/format";

interface FilterState {
  /** Empty means every store. */
  storeIds: string[];
  dateFrom: string;
  dateTo: string;
  campaignId: string | null;
  itemGroupId: string | null;
  accountName: string | null;
  contentType: ShopContentType | "ALL";
  /**
   * Scope, not a narrowing filter: it decides which GMV Max product the page is about, the way
   * the store and date range decide which data exists at all
   */
  promotionType: PromotionType;
  /** TikTok identity_id. Live-only: Product campaigns have no creator of their own. */
  identityId: string | null;

  setStoreIds: (storeIds: string[]) => void;
  setDateRange: (dateFrom: string, dateTo: string) => void;
  setCampaignId: (campaignId: string | null) => void;
  setItemGroupId: (itemGroupId: string | null) => void;
  setAccountName: (accountName: string | null) => void;
  setContentType: (contentType: ShopContentType | "ALL") => void;
  setPromotionType: (promotionType: PromotionType) => void;
  setIdentityId: (identityId: string | null) => void;
  clearFilters: () => void;
}

/** Last 7 days, matching what the bot's default report covers. */
function defaults() {
  return {
    storeIds: [],
    dateFrom: daysAgo(6),
    dateTo: toIsoDate(new Date()),
    campaignId: null,
    itemGroupId: null,
    accountName: null,
    contentType: "ALL" as const,
    promotionType: "PRODUCT" as const,
    identityId: null,
  };
}

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      ...defaults(),

      // Narrowing filters name ids that only exist within one store, so changing the selection
      // clears them rather than sending a campaign id the new set never had
      setStoreIds: (storeIds) =>
        set({ storeIds, campaignId: null, itemGroupId: null, accountName: null, identityId: null }),

      setDateRange: (dateFrom, dateTo) => set({ dateFrom, dateTo }),
      setCampaignId: (campaignId) => set({ campaignId }),
      setItemGroupId: (itemGroupId) => set({ itemGroupId }),
      setAccountName: (accountName) => set({ accountName }),
      setContentType: (contentType) => set({ contentType }),

      /*
       * Product, creator and content type describe creatives, which only Product campaigns
       * have, and the campaign list is per type
       */
      setPromotionType: (promotionType) =>
        set({
          promotionType,
          campaignId: null,
          itemGroupId: null,
          accountName: null,
          contentType: "ALL",
          // The creator picker is Live-only, and its ids mean nothing under Product.
          identityId: null,
        }),

      setIdentityId: (identityId) => set({ identityId }),

      // Store and date range survive: they scope which data exists at all, rather than
      // narrowing it, and re-picking them every time is a nuisance
      clearFilters: () =>
        set({
          campaignId: null,
          itemGroupId: null,
          accountName: null,
          contentType: "ALL",
          identityId: null,
        }),
    }),
    {
      name: "gmv-max-filters",
      // 2: storeId (a single string) became storeIds (an array)
      version: 2,
      // Only the scope is remembered
      partialize: (state) => ({ storeIds: state.storeIds }),
    },
  ),
);

/** The range every `/analytics/*` call takes, derived from current filter state. */
export function toRangeQuery(state: FilterState): RangeQuery {
  return {
    storeIds: state.storeIds,
    from: state.dateFrom,
    to: state.dateTo,
    campaignId: state.campaignId ?? undefined,
    itemGroupId: state.itemGroupId ?? undefined,
    promotionType: state.promotionType,
    identityId: state.identityId ?? undefined,
  };
}

/** How many narrowing filters are active, for the "ล้างตัวกรอง (n)" affordance. */
export function countActiveFilters(state: {
  campaignId: string | null;
  itemGroupId: string | null;
  accountName: string | null;
  contentType: ShopContentType | "ALL";
  identityId: string | null;
}): number {
  let count = 0;
  if (state.campaignId) count += 1;
  if (state.itemGroupId) count += 1;
  if (state.accountName) count += 1;
  if (state.contentType !== "ALL") count += 1;
  if (state.identityId) count += 1;
  return count;
}
