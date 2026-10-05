import type { RangeQuery } from "@/types/report";
import { fetchAllDays, fetchSummary } from "./analytics";

/** Match the top cards' scope, not the independently filtered creative/room table. */
export async function fetchOverallExport(query: RangeQuery) {
  const scope: RangeQuery = {
    from: query.from, to: query.to, storeIds: query.storeIds,
    promotionType: query.promotionType,
    identityId: query.promotionType === "LIVE" ? query.identityId : undefined,
  };
  // One daily query, not one request per date. Fetch at click time, avoiding stale card caches.
  const [days, summary] = await Promise.all([fetchAllDays(scope), fetchSummary(scope)]);
  return { days, totals: summary.current, range: scope };
}
