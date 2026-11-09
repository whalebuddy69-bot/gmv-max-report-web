import { z } from "zod";
import { ApiError, http, request } from "./client";

const path = "/automation/live-discovery";
const instant = z.string().datetime({ offset: true });
const providerId = z.string().regex(/^[1-9]\d{5,30}$/);
const providerLabel = z.string().trim().min(1).max(256);
const verifiedUsername = z.string().regex(/^[A-Za-z0-9_.]{1,24}$/)
  .refine((value) => !value.endsWith("."));

const discoveredCampaignSchema = z.object({
  advertiserId: providerId,
  advertiserName: providerLabel,
  campaignId: providerId,
  campaignName: providerLabel,
  secondaryStatus: z.string().regex(/^[A-Z0-9_]{1,120}$/).nullable(),
  kind: z.enum(["creator", "shop", "unknown"]),
  tiktokUsername: verifiedUsername.nullable(),
  shopId: providerId.nullable().optional(),
  shopName: providerLabel.nullable(),
}).refine((row) => row.kind === "shop" || (row.shopName === null && row.shopId == null), {
  message: "Shop metadata requires a verified Shop-linked campaign",
});

export const automationLiveDiscoverySchema = z.object({
  schemaVersion: z.literal(1),
  state: z.enum(["refreshing", "ready", "partial", "unavailable"]),
  checkedAt: instant.nullable(),
  accountsChecked: z.number().int().min(0).max(1_000),
  accountsTotal: z.number().int().min(0).max(1_000),
  canAddCreators: z.boolean().optional(),
  campaigns: z.array(discoveredCampaignSchema).max(2_000),
}).superRefine((snapshot, context) => {
  if (snapshot.accountsChecked > snapshot.accountsTotal) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountsChecked"], message: "Checked exceeds total accounts" });
  }
  if (snapshot.state === "ready" && snapshot.accountsChecked !== snapshot.accountsTotal) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["state"], message: "Incomplete discovery cannot be ready" });
  }
  const ids = snapshot.campaigns.map((row) => `${row.advertiserId}:${row.campaignId}`);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["campaigns"], message: "Duplicate advertiser and campaign" });
  }
});

export type AutomationLiveDiscovery = z.infer<typeof automationLiveDiscoverySchema>;
export type AutomationDiscoveredLiveCampaign = AutomationLiveDiscovery["campaigns"][number];

const enrollInput = z.object({ advertiserId: providerId, campaignId: providerId, expectedUsername: verifiedUsername }).strict();
const enrollResult = z.object({
  clientId: z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  advertiserId: providerId,
});
export type AutomationCreatorEnrollment = z.infer<typeof enrollResult>;

export function fetchAutomationLiveDiscovery(signal?: AbortSignal) {
  return request(automationLiveDiscoverySchema, "LIVE GMV Max discovery", () => http.get(path, { signal }));
}

export function refreshAutomationLiveDiscovery(signal?: AbortSignal) {
  return request(automationLiveDiscoverySchema, "LIVE GMV Max refresh", () =>
    http.post(`${path}/refresh`, undefined, { signal }),
  );
}

export async function enrollDiscoveredCreator(input: z.input<typeof enrollInput>, signal?: AbortSignal) {
  const parsed = enrollInput.safeParse(input);
  if (!parsed.success) throw new ApiError("ข้อมูลบัญชีไม่ถูกต้อง", { code: "INVALID_CREATOR_ENROLLMENT" });
  return request(enrollResult.refine((result) => result.advertiserId === parsed.data.advertiserId), "Creator enrollment", () =>
    http.post(`${path}/enroll`, parsed.data, { signal }),
  );
}
