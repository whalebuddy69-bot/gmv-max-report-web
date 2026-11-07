import { z } from "zod";
import { http, request } from "./client";

const instant = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneyMinor = z.number().int().safe().nonnegative();
const positiveBudget = moneyMinor.positive();
const label = z.string().trim().min(1).max(256);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const nullableRoi = z.number().finite().nonnegative().nullable();
const campaignSchema = z.object({
  campaignId: id,
  campaignName: label,
  campaignStatus: z.literal("ACTIVE"),
  dailyBudgetMinor: positiveBudget,
  spendMinor: moneyMinor.nullable(),
  targetRoi: nullableRoi,
  currency: z.literal("THB"),
});
const clientSchema = z.object({
  clientId: id,
  displayName: label,
  advertiserId: id,
  tiktokAccountId: id,
  access: z.enum(["verified", "unavailable"]),
  observedAt: instant.nullable(),
  reportingDate: day.nullable(),
  campaign: campaignSchema.nullable(),
  capMinor: z.null(),
  actions: z.object({
    start: z.literal(false),
    pause: z.literal(false),
    increaseBudget: z.literal(false),
    decreaseBudget: z.literal(false),
    auto: z.literal(false),
  }),
});
export const automationOverviewSchema = z.object({
  schemaVersion: z.literal(1),
  checkedAt: instant,
  coverage: z.literal("configured-creators-only"),
  clients: z.array(clientSchema),
});

const pointSchema = z.object({
  hour: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  spendMinor: moneyMinor.nullable(),
  gmvMinor: moneyMinor.nullable(),
  orders: z.number().int().safe().nonnegative().nullable(),
  roi: nullableRoi,
  liveViews: z.number().int().safe().nonnegative().nullable().default(null),
});
export const automationPerformanceSchema = z.object({
  schemaVersion: z.literal(1),
  checkedAt: instant,
  observedAt: instant.nullable().default(null),
  clientId: id,
  campaignId: id.nullable(),
  reportingDate: day.nullable(),
  granularity: z.literal("hour"),
  state: z.enum(["available", "no-active-campaign", "unavailable"]),
  series: z.array(pointSchema).max(24).refine(
    (series) => new Set(series.map((point) => point.hour)).size === series.length,
    "hour values must be unique",
  ),
});

export type AutomationClient = z.infer<typeof clientSchema>;
export type AutomationCampaign = z.infer<typeof campaignSchema>;
export type AutomationOverview = z.infer<typeof automationOverviewSchema>;
export type AutomationPerformance = z.infer<typeof automationPerformanceSchema>;
export type AutomationPoint = z.infer<typeof pointSchema>;

export function fetchAutomationOverview(signal?: AbortSignal) {
  return request(automationOverviewSchema, "Automation overview", () =>
    http.get("/automation/overview", { signal }),
  );
}

export function fetchAutomationPerformance(signal?: AbortSignal) {
  return request(automationPerformanceSchema, "Automation performance", () =>
    http.get("/automation/performance", { signal }),
  );
}
