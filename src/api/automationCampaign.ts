import { z } from "zod";
import { PILOT_BUDGET_CLIENT_ID } from "./automation";
import { http, request } from "./client";

const root = "/automation/campaign";
const campaignId = z.string().regex(/^[1-9]\d{5,30}$/);
const operationStatus = z.enum(["ENABLE", "DISABLE"]);
const action = z.enum(["SET_ROI", "PAUSE", "RESUME"]);
const mode = z.enum(["dry-run", "live"]);
const roiTenths = z.number().int().positive().safe();
const instant = z.string().datetime({ offset: true });
const operationId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

export const campaignControlStatusSchema = z.object({
  clientId: z.literal(PILOT_BUDGET_CLIENT_ID),
  mode: z.enum(["disabled", "dry-run", "live"]),
  campaign: z.object({ campaignId, campaignName: z.string().max(512), operationStatus, roiTargetTenths: roiTenths, observedAt: instant }).nullable(),
  capabilities: z.object({ setRoi: z.boolean(), pause: z.boolean(), resume: z.boolean(), create: z.literal(false) }),
  blocker: z.string().min(1).max(100).nullable(),
}).refine(({ campaign, mode: activeMode, capabilities }) => !(capabilities.setRoi || capabilities.pause || capabilities.resume) ||
  (activeMode !== "disabled" && campaign !== null && (!capabilities.pause || campaign.operationStatus === "ENABLE") &&
    (!capabilities.resume || campaign.operationStatus === "DISABLE")), "campaign action requires a matching campaign");

const campaignReviewInputSchema = z.object({
  campaignId, action, expectedStatus: operationStatus, expectedRoiTenths: roiTenths,
  targetRoiTenths: roiTenths.max(9999).optional(),
}).strict().refine((value) => value.action === "SET_ROI" ? value.targetRoiTenths !== undefined && value.targetRoiTenths !== value.expectedRoiTenths
  : value.targetRoiTenths === undefined && value.expectedStatus === (value.action === "PAUSE" ? "ENABLE" : "DISABLE"), "invalid campaign action review");

export const campaignActionPreviewSchema = z.object({
  sent: z.literal(false), operationId: operationId.optional(), action, campaignId,
  before: z.object({ status: operationStatus, roiTenths }), after: z.object({ status: operationStatus, roiTenths }),
  expiresAt: instant.optional(), mode,
}).refine((value) => value.mode === "dry-run" ? value.operationId === undefined && value.expiresAt === undefined
  : value.operationId !== undefined && value.expiresAt !== undefined, "invalid campaign action mode");

export type CampaignControlStatus = z.infer<typeof campaignControlStatusSchema>;
export type CampaignControlAction = z.infer<typeof action>;
export type CampaignReviewInput = z.infer<typeof campaignReviewInputSchema>;
export type CampaignActionPreview = z.infer<typeof campaignActionPreviewSchema>;
export type LiveCampaignActionPreview = CampaignActionPreview & { mode: "live"; operationId: string; expiresAt: string };
const campaignOperationSchema = z.object({ operationId, action, campaignId,
  status: z.enum(["PREPARED", "PROCESSING", "NOT_SENT", "APPLIED_VERIFIED", "OUTCOME_UNKNOWN"]), sent: z.boolean().nullable(),
}).refine(({ status, sent }) => sent === (status === "APPLIED_VERIFIED" ? true : status === "PREPARED" || status === "NOT_SENT" ? false : null),
  "result does not establish whether TikTok applied the action");
export type CampaignOperation = z.infer<typeof campaignOperationSchema>;

export function isConfirmableCampaignPreview(review: CampaignActionPreview, now = Date.now()): review is LiveCampaignActionPreview {
  const parsed = campaignActionPreviewSchema.safeParse(review);
  if (!parsed.success || review.mode !== "live" || !review.operationId || !review.expiresAt) return false;
  const remaining = Date.parse(review.expiresAt) - now;
  return Number.isFinite(remaining) && remaining > 0 && remaining <= 125_000;
}

export function fetchCampaignControlStatus(signal?: AbortSignal) {
  return request(campaignControlStatusSchema, "Campaign control status", () => http.get(`${root}/status`, { signal }));
}

export function previewCampaignControl(input: CampaignReviewInput) {
  return request(campaignActionPreviewSchema.refine((result) => result.campaignId === input.campaignId && result.action === input.action &&
    result.before.status === input.expectedStatus && result.before.roiTenths === input.expectedRoiTenths &&
    result.after.status === (input.action === "PAUSE" ? "DISABLE" : input.action === "RESUME" ? "ENABLE" : input.expectedStatus) &&
    result.after.roiTenths === (input.action === "SET_ROI" ? input.targetRoiTenths : input.expectedRoiTenths), "review does not match the campaign or action"),
  "Campaign action review", () => http.post(`${root}/preview`, campaignReviewInputSchema.parse(input)));
}

export async function confirmCampaignControl(review: CampaignActionPreview) {
  if (!isConfirmableCampaignPreview(review)) throw new Error("No live campaign action to confirm");
  return request(campaignOperationSchema.refine(result => result.operationId === review.operationId &&
    result.campaignId === review.campaignId && result.action === review.action, "operation does not match the reviewed campaign"),
  "Campaign action result", () => http.post(`${root}/confirm`, { operationId: review.operationId, confirmed: true }));
}

export async function readCampaignOperation(value: string, expected?: Pick<CampaignActionPreview, "action" | "campaignId">) {
  const exact = operationId.parse(value);
  return request(campaignOperationSchema.refine(result => result.operationId === exact &&
    (!expected || result.campaignId === expected.campaignId && result.action === expected.action), "operation does not match the original request"),
  "Campaign action status", () => http.get(`${root}/operations/${exact}`));
}
