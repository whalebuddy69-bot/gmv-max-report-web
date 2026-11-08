import type { AutomationClient, AutomationPerformance, AutomationPoint } from "@/api/automation";

export const MAX_OBSERVATION_AGE_MS = 180_000;
const MAX_CHART_OBSERVATION_AGE_MS = 360_000;
export const BANGKOK = "Asia/Bangkok";

const bangkokDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BANGKOK,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function bangkokDay(time: number) {
  const parts = Object.fromEntries(
    bangkokDayFormatter.formatToParts(time).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isFreshAutomationClient(client: AutomationClient, now = Date.now()) {
  if (client.access !== "verified" || client.observedAt === null || !Number.isFinite(now)) return false;
  const age = now - Date.parse(client.observedAt);
  return age >= -30_000 && age <= MAX_OBSERVATION_AGE_MS && client.reportingDate === bangkokDay(now);
}

export function performanceMatchesClient(result: AutomationPerformance, client: AutomationClient) {
  return client.campaign !== null
    && client.reportingDate !== null
    && result.clientId === client.clientId
    && result.campaignId === client.campaign.campaignId
    && result.reportingDate === client.reportingDate;
}

export function isStalePerformance(result: AutomationPerformance, now = Date.now()) {
  if (result.observedAt === null) return false; // unverified time is labeled, never called fresh
  const age = now - Date.parse(result.observedAt);
  return !Number.isFinite(age) || age < -30_000 || age > MAX_CHART_OBSERVATION_AGE_MS;
}

/** Keep unverified timestamps, stale responses and mismatched account/campaign/day off the row. */
export function creatorRowPerformance(result: AutomationPerformance | undefined, client: AutomationClient, now = Date.now()) {
  if (!result || !isFreshAutomationClient(client, now) || !performanceMatchesClient(result, client)) return null;
  if (result.state === "available" && (result.observedAt === null || isStalePerformance(result, now))) return null;
  return result;
}

type SummableMetric = "spendMinor" | "gmvMinor" | "orders" | "liveViews";

export function totalForReturnedHours(series: readonly AutomationPoint[], metric: SummableMetric) {
  if (series.length === 0) return null;
  let total = 0;
  for (const point of series) {
    const value = point[metric];
    if (value === null) return null;
    total += value;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

/** Summary of returned hours only; an unreturned hour is not zero or an all-day total. */
export function summarizeCreatorPerformance(series: readonly AutomationPoint[]) {
  const spend = totalForReturnedHours(series, "spendMinor");
  const gmvMinor = totalForReturnedHours(series, "gmvMinor");
  return {
    gmvMinor,
    orders: totalForReturnedHours(series, "orders"),
    roi: gmvMinor !== null && spend !== null && spend > 0 ? gmvMinor / spend : null,
    liveViews: totalForReturnedHours(series, "liveViews"),
  };
}

export type AutomationMetric = "spendMinor" | "gmvMinor" | "orders" | "roi" | "liveViews";

const minutes = (hour: string) => Number(hour.slice(0, 2)) * 60 + Number(hour.slice(3));
export const formatHour = (value: number) =>
  `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;

export function toHourlyChart(series: readonly AutomationPoint[], metric: AutomationMetric) {
  const sorted = [...series].sort((a, b) => minutes(a.hour) - minutes(b.hour));
  const rows: { minute: number; value: number | null }[] = [];
  for (const point of sorted) {
    const minute = minutes(point.hour);
    const previous = rows.at(-1)?.minute;
    // An unreturned hour is unknown. Break the line instead of interpolating it.
    if (previous !== undefined && minute - previous > 60) rows.push({ minute: previous + 60, value: null });
    const value = point[metric];
    rows.push({
      minute,
      value: value === null ? null : metric === "spendMinor" || metric === "gmvMinor" ? value / 100 : value,
    });
  }
  return rows;
}
