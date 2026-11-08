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
  sent: z.literal(false), operationId: z.string().uuid().optional(), action, campaignId,
  before: z.object({ status: operationStatus, roiTenths }), after: z.object({ status: operationStatus, roiTenths }),
  expiresAt: instant.optional(), mode,
}).refine((value) => value.mode === "dry-run" ? value.operationId === undefined && value.expiresAt === undefined
  : value.operationId !== undefined && value.expiresAt !== undefined, "invalid campaign action mode");

export type CampaignControlStatus = z.infer<typeof campaignControlStatusSchema>;
export type CampaignControlAction = z.infer<typeof action>;
export type CampaignReviewInput = z.infer<typeof campaignReviewInputSchema>;
export type CampaignActionPreview = z.infer<typeof campaignActionPreviewSchema>;

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
