import { z } from "zod";
import { ApiError, http, request } from "./client";

const instant = z.string().datetime({ offset: true });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moneyMinor = z.number().int().safe().nonnegative();
const positiveBudget = moneyMinor.positive();
const label = z.string().trim().min(1).max(256);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const creatorSlug = /^[a-z][a-z0-9_-]{1,39}$/;
const creatorId = z.string().regex(creatorSlug);
export const PILOT_BUDGET_CLIENT_ID = "punpan_020";
const nullableRoi = z.number().finite().nonnegative().nullable();
const campaignSchema = z.object({
  campaignId: id,
  campaignName: label,
  campaignStatus: z.literal("ACTIVE"),
  dailyBudgetMinor: positiveBudget,
  spendMinor: moneyMinor.nullable(),
  targetRoi: nullableRoi,
  currency: z.literal("THB"),
  scheduleStartAt: instant.nullable().optional(),
  scheduleEndAt: instant.nullable().optional(),
  viewerBoostBudgetMinor: moneyMinor.nullable().optional(),
});
const clientSchema = z.object({
  clientId: creatorId,
  displayName: label,
  advertiserId: id,
  tiktokAccountId: id,
  tiktokUsername: z.string().regex(/^[A-Za-z0-9_.]{1,24}$/).refine((value) => !value.endsWith(".")).nullable().optional(),
  tiktokAccountIdVerified: z.boolean().optional(),
  access: z.enum(["verified", "unavailable"]),
  accessReason: z.enum(["needs-authorization", "identity-unverified", "upstream-unavailable"]).optional(),
  budgetControlAvailable: z.boolean().optional(),
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
  clients: z.array(clientSchema).max(100).refine(
    (clients) => new Set(clients.map((client) => client.clientId)).size === clients.length,
    "Creator IDs must be unique",
  ),
});

const pointSchema = z.object({
  hour: z.string().regex(/^(?:[01]\d|2[0-3]):00$/),
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
  clientId: creatorId,
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

export function automationPerformancePath(clientId: string) {
  if (!creatorSlug.test(clientId)) throw new ApiError("รหัส Creator ไม่ถูกต้อง", { code: "INVALID_CREATOR_SCOPE" });
  return `/automation/performance/${clientId}`;
}

export async function fetchAutomationPerformance(clientId: string, signal?: AbortSignal) {
  const path = automationPerformancePath(clientId);
  try {
    return await request(automationPerformanceSchema, "Automation performance", () => http.get(path, { signal }));
  } catch (error) {
    // Only the existing pilot has a legacy endpoint, never fall back for another Creator.
    if (clientId !== PILOT_BUDGET_CLIENT_ID || signal?.aborted || !(error instanceof ApiError) || error.status !== 404) throw error;
    return request(automationPerformanceSchema, "Automation performance", () => http.get("/automation/performance", { signal }));
  }
}
