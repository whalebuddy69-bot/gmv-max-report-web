import { z } from "zod";
import { ApiError, http, request } from "./client";

const creatorSlug = /^[a-z][a-z0-9_-]{1,39}$/;
const instant = z.string().datetime({ offset: true });
const moneyMinor = z.number().int().safe().nonnegative();
const ratio = z.number().finite().nonnegative().nullable();

const row = z.object({
  campaignId: z.string().regex(/^[1-9]\d{5,30}$/),
  campaignName: z.string().trim().min(1).max(512),
  operationStatus: z.enum(["ENABLE", "DISABLE", "DELETE"]),
  dailyBudgetMinor: moneyMinor.positive().nullable(),
  targetRoi: ratio,
  spendMinor: moneyMinor.nullable(),
  gmvMinor: moneyMinor.nullable(),
  roi: ratio,
  activityToday: z.boolean(),
  scheduleStartAt: instant.nullable(),
  scheduleEndAt: instant.nullable(),
}).refine(({ operationStatus, activityToday, spendMinor, gmvMinor, roi }) =>
  (operationStatus === "ENABLE" || activityToday) && roi === (spendMinor !== null && spendMinor > 0 && gmvMinor !== null ? gmvMinor / spendMinor : null),
  "campaign activity or ROI is not supported by the same-day report");

export const automationCampaignsTodaySchema = z.object({
  schemaVersion: z.literal(1),
  checkedAt: instant,
  clientId: z.string().regex(creatorSlug),
  reportingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observedAt: instant.nullable(),
  coverage: z.enum(["complete", "partial", "unavailable"]),
  campaigns: z.array(row).max(40).refine((values) => new Set(values.map(({ campaignId }) => campaignId)).size === values.length,
    "campaign IDs must be unique"),
}).refine(({ observedAt, coverage, campaigns }) => coverage === "unavailable" ? campaigns.length === 0 && observedAt === null : observedAt !== null,
  "campaign coverage requires a verified observation");

export type AutomationCampaignToday = z.infer<typeof row>;
export type AutomationCampaignsToday = z.infer<typeof automationCampaignsTodaySchema>;

export function automationCampaignsTodayPath(clientId: string) {
  if (!creatorSlug.test(clientId)) throw new ApiError("รหัส Creator ไม่ถูกต้อง", { code: "INVALID_CREATOR_SCOPE" });
  return `/automation/campaigns/${clientId}`;
}

export function fetchAutomationCampaignsToday(clientId: string, signal?: AbortSignal) {
  const path = automationCampaignsTodayPath(clientId);
  return request(automationCampaignsTodaySchema.refine((response) => response.clientId === clientId, "unexpected Creator campaign scope"),
    "Creator campaigns today", () => http.get(path, { signal }));
}
