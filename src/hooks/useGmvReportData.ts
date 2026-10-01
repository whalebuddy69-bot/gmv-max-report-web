import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  CampaignOption,
  CampaignRow,
  CreativesQuery,
  CreativesResponse,
  CreatorOption,
  CreatorRow,
  LiveRoomRow,
  ProductRow,
  RangeQuery,
  StoreOption,
  SummaryResponse,
  TimeseriesPoint,
} from "@/types/report";
import * as api from "@/api/analytics";

const FIVE_MINUTES = 5 * 60 * 1000;

/** An empty `storeIds` is a real selection */
function hasScope(query: RangeQuery): boolean {
  return Boolean(query.from && query.to);
}

/** Store list for the picker. Not scoped to a range, it is the thing that sets scope. */
export function useStores(): UseQueryResult<StoreOption[], Error> {
  return useQuery({
    queryKey: ["gmv", "stores"],
    queryFn: () => api.fetchStores(),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}

/** KPI cards, with the same-length previous period for deltas. */
export function useSummary(query: RangeQuery): UseQueryResult<SummaryResponse, Error> {
  return useQuery({
    queryKey: ["gmv", "summary", query],
    queryFn: () => api.fetchSummary(query),
    enabled: hasScope(query),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useTimeseries(query: RangeQuery): UseQueryResult<TimeseriesPoint[], Error> {
  return useQuery({
    queryKey: ["gmv", "timeseries", query],
    queryFn: () => api.fetchTimeseries(query),
    enabled: hasScope(query),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useCampaigns(
  query: RangeQuery,
  // The dashboard only reads campaigns when Live is in scope, and hooks cannot be called
  // conditionally
  options: { enabled?: boolean } = {},
): UseQueryResult<CampaignRow[], Error> {
  return useQuery({
    queryKey: ["gmv", "campaigns", query],
    queryFn: () => api.fetchCampaigns(query),
    enabled: hasScope(query) && (options.enabled ?? true),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useCampaignOptions(query: RangeQuery): UseQueryResult<CampaignOption[], Error> {
  return useQuery({
    // promotionType belongs in the key: the campaign list is per type, and without it switching
    // scope would serve the previous type's campaigns out of cache
    queryKey: ["gmv", "campaignOptions", query.storeIds, query.from, query.to, query.promotionType],
    queryFn: () =>
      api.fetchCampaignOptions({
        storeIds: query.storeIds,
        from: query.from,
        to: query.to,
        promotionType: query.promotionType,
      }),
    enabled: hasScope(query),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
}

/** Products for the range */
export function useCreatorOptions(
  query: RangeQuery,
  /** Live-only: Product campaigns carry no identity. */
  options: { enabled?: boolean } = {},
): UseQueryResult<CreatorOption[], Error> {
  return useQuery({
    queryKey: ["gmv", "creatorOptions", query.storeIds, query.from, query.to],
    queryFn: () =>
      api.fetchCreatorOptions({ storeIds: query.storeIds, from: query.from, to: query.to }),
    enabled: hasScope(query) && (options.enabled ?? true),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
}

export function useLiveRooms(
  query: RangeQuery,
  /** Only the Live tab has anything to show here. */
  options: { enabled?: boolean } = {},
): UseQueryResult<LiveRoomRow[], Error> {
  return useQuery({
    queryKey: ["gmv", "liveRooms", query],
    queryFn: () => api.fetchLiveRooms(query),
    enabled: hasScope(query) && (options.enabled ?? true),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useProducts(
  query: RangeQuery,
  /** Off at campaign grain: Live campaigns have no products to list or name. */
  options: { enabled?: boolean } = {},
): UseQueryResult<ProductRow[], Error> {
  return useQuery({
    queryKey: ["gmv", "products", query],
    queryFn: () => api.fetchProducts(query),
    enabled: hasScope(query) && (options.enabled ?? true),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

export function useCreators(
  query: RangeQuery & { minCost?: number },
  /** Off at campaign grain: creators exist only on Product campaigns' creatives. */
  options: { enabled?: boolean } = {},
): UseQueryResult<CreatorRow[], Error> {
  return useQuery({
    queryKey: ["gmv", "creators", query],
    queryFn: () => api.fetchCreators(query),
    enabled: hasScope(query) && (options.enabled ?? true),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}

/** The main report table, one row per creative, totalled over the range. */
export function useCreatives(
  query: CreativesQuery,
  /** Off while the page is reporting at campaign grain, see useCampaigns. */
  options: { enabled?: boolean } = {},
): UseQueryResult<CreativesResponse, Error> {
  return useQuery({
    queryKey: ["gmv", "creatives", query],
    queryFn: () => api.fetchCreatives(query),
    enabled: hasScope(query) && (options.enabled ?? true),
    staleTime: FIVE_MINUTES,
    placeholderData: keepPreviousData,
    retry: 1,
  });
}
