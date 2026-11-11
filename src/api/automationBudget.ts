import { z } from "zod";
import { PILOT_BUDGET_CLIENT_ID } from "./automation";
import { http, request } from "./client";

const instant = z.string().datetime({ offset: true });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const tiktokNumericId = z.string().regex(/^[1-9]\d{5,30}$/);
const operationId = z.string().uuid();
const positiveMinor = z.number().int().safe().positive();
const commandMode = z.enum(["dry-run", "live"]);
export const SRIHIW_CAP_CLIENT_ID = "srihiw";
export const NNSHOP_CAP_CLIENT_ID = "nnshop5719";
export const ASHOP_CAP_CLIENT_ID = "ashopbytheta";
export const MYUSHOP_CAP_CLIENT_ID = "myushop4";
export const BUBPA_CAP_CLIENT_ID = "bubpa_shop189";
export const KOOLKOOL_CAP_CLIENT_ID = "koolkool888";
export const BOOMKAN_CAP_CLIENT_ID = "boomkan";
export const VERIFIED_ROOM_SPEND_TREND = "verified-room-spend-trend";
export const WAITING_FOR_LIVE = "WAITING_FOR_LIVE";
export const LIVE_WAITING_FOR_SPEND = "LIVE_WAITING_FOR_SPEND";
const verifiedRoomSpendTrendIds = [ASHOP_CAP_CLIENT_ID, MYUSHOP_CAP_CLIENT_ID, BUBPA_CAP_CLIENT_ID, KOOLKOOL_CAP_CLIENT_ID, BOOMKAN_CAP_CLIENT_ID] as const;
const extraBudgetIds = [SRIHIW_CAP_CLIENT_ID, NNSHOP_CAP_CLIENT_ID, ...verifiedRoomSpendTrendIds] as const;
const budgetIds = [PILOT_BUDGET_CLIENT_ID, ...extraBudgetIds] as const;
const continuousBudgetIds = [PILOT_BUDGET_CLIENT_ID, SRIHIW_CAP_CLIENT_ID, NNSHOP_CAP_CLIENT_ID, ...verifiedRoomSpendTrendIds] as const;
const autoEvidenceModeSchema = z.enum(["spend-trend", "verified-room", VERIFIED_ROOM_SPEND_TREND]);
export type AdditionalBudgetCapClientId = typeof extraBudgetIds[number];
export type BudgetCapClientId = typeof budgetIds[number];
export type ContinuousBudgetClientId = typeof continuousBudgetIds[number];
export function isAdditionalBudgetCapClientId(value: string): value is AdditionalBudgetCapClientId {
  return extraBudgetIds.some((clientId) => clientId === value);
}
export function isBudgetCapClientId(value: string): value is BudgetCapClientId {
  return value === PILOT_BUDGET_CLIENT_ID || isAdditionalBudgetCapClientId(value);
}
export function isContinuousBudgetClientId(value: string): value is ContinuousBudgetClientId {
  return continuousBudgetIds.some((clientId) => clientId === value);
}
export function requiresVerifiedRoomSpendTrendAuto(clientId: string): boolean {
  return verifiedRoomSpendTrendIds.some((id) => id === clientId);
}
export function supportsAutoWaitingForLive(clientId: string): boolean {
  // Feature eligibility only. The server still checks binding, operator and write readiness.
  return isContinuousBudgetClientId(clientId);
}
export function supportsContinuousAutoEvidence(clientId: string, evidenceMode: z.infer<typeof autoEvidenceModeSchema> | undefined): boolean {
  if (evidenceMode === VERIFIED_ROOM_SPEND_TREND) return isContinuousBudgetClientId(clientId);
  if (clientId === SRIHIW_CAP_CLIENT_ID) return evidenceMode === "spend-trend";
  return clientId === PILOT_BUDGET_CLIENT_ID && (evidenceMode === undefined || evidenceMode === "verified-room" || evidenceMode === "spend-trend");
}
const capSchema = z.object({
  revision: z.number().int().safe().positive(),
  campaignCapMinor: positiveMinor,
  clientDailyCapMinor: positiveMinor,
  readAt: instant,
  locked: z.boolean(),
});

export const budgetStatusSchema = z.object({
  clientId: z.enum(budgetIds),
  mode: z.enum(["disabled", "dry-run", "live"]),
  cap: capSchema.nullable(),
  canPrepare: z.boolean(),
  capEditAllowed: z.boolean().default(false),
}).refine((status) => !status.canPrepare || (
  status.mode !== "disabled" && status.cap !== null && !status.cap.locked
), "enabled action requires an unlocked, known policy");

const budgetCapInputSchema = z.object({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  capMinor: positiveMinor,
}).strict();

const budgetCapResultSchema = z.object({
  revision: positiveMinor,
  capMinor: positiveMinor,
});

const additionalBudgetCapStatusSchema = z.object({
  clientId: z.enum(extraBudgetIds),
  cap: capSchema.nullable(),
  capEditAllowed: z.boolean().default(false),
});

const autoStatusCode = z.string().min(1).max(100);
const autoPreviewSchema = z.object({
  status: autoStatusCode,
  campaignId: id,
  liveSessionId: tiktokNumericId.nullable().optional(),
  liveSessionStartedAt: instant.optional(),
  waitingForLive: z.boolean().optional(),
  autoDetectLive: z.literal(true).optional(),
  allowExhaustedRecovery: z.literal(true).optional(),
  keepAutoAcrossRooms: z.literal(true).optional(),
  currentBudgetMinor: positiveMinor,
  spendMinor: z.number().int().safe().nonnegative().nullable(),
  thresholdMinor: positiveMinor,
  targetBudgetMinor: positiveMinor.nullable(),
  projectedClientSpendMinor: positiveMinor.nullable(),
  policyRevision: positiveMinor,
  observedAt: instant,
}).refine((value) => value.thresholdMinor <= value.currentBudgetMinor
  && (value.targetBudgetMinor === null || value.targetBudgetMinor > value.currentBudgetMinor)
  && (value.projectedClientSpendMinor === null || (value.targetBudgetMinor !== null && value.projectedClientSpendMinor >= value.targetBudgetMinor)),
"invalid Auto budget preview");

export const budgetAutoStatusSchema = z.object({
  clientId: z.enum(budgetIds),
  mode: z.enum(["disabled", "shadow", "live"]),
  strategy: z.enum(["continuous", "one-shot"]).optional(),
  evidenceMode: autoEvidenceModeSchema.optional(),
  overviewState: z.enum(["on", "off", "pending", "blocked"]).nullable().optional(),
  grant: z.object({ grantId: operationId, status: autoStatusCode, expiresAt: instant }).nullable(),
  continuousSession: z.object({
    sessionId: operationId,
    status: z.enum(["ARMED", "SENDING", "BLOCKED", "STOPPED"]),
    startedAt: instant,
    reason: autoStatusCode.nullable().optional(),
    waitingForLive: z.boolean().optional(),
    autoDetectLive: z.literal(true).optional(),
    allowExhaustedRecovery: z.literal(true).optional(),
    keepAutoAcrossRooms: z.literal(true).optional(),
  }).nullable().optional(),
  preview: autoPreviewSchema.nullable(),
  blockers: z.array(autoStatusCode).max(24),
  canArm: z.boolean().optional(),
  canStop: z.boolean().optional(),
}).refine((value) => (!requiresVerifiedRoomSpendTrendAuto(value.clientId) && value.evidenceMode !== VERIFIED_ROOM_SPEND_TREND) ||
  (value.strategy === "continuous" && value.grant === null),
  "this Creator requires continuous Auto")
  .refine((value) => value.strategy !== "continuous" || supportsContinuousAutoEvidence(value.clientId, value.evidenceMode),
  "invalid continuous Auto strategy scope")
  .refine((value) => value.continuousSession == null || (isContinuousBudgetClientId(value.clientId) && value.strategy === "continuous"),
    "invalid continuous Auto session scope")
  .refine((value) => value.evidenceMode === undefined || (value.strategy === "continuous" && supportsContinuousAutoEvidence(value.clientId, value.evidenceMode)),
    "evidence mode requires a supported continuous Auto scope")
  .refine((value) => {
    const preview = value.preview;
    if (!preview) return true;
    const scoped = supportsAutoWaitingForLive(value.clientId) && value.strategy === "continuous";
    const hasRoom = typeof preview.liveSessionId === "string";
    if ((preview.allowExhaustedRecovery === true || preview.keepAutoAcrossRooms === true) && preview.autoDetectLive !== true) return false;
    if (preview.liveSessionStartedAt !== undefined && (!scoped || !hasRoom || preview.waitingForLive === true)) return false;
    if (preview.waitingForLive === true) {
      return scoped && preview.liveSessionId === null && preview.status === WAITING_FOR_LIVE &&
        (preview.spendMinor === null || preview.autoDetectLive === true);
    }
    const detectedRoom = scoped && value.evidenceMode === VERIFIED_ROOM_SPEND_TREND && preview.autoDetectLive === true && hasRoom;
    if (preview.status === LIVE_WAITING_FOR_SPEND) return detectedRoom && preview.spendMinor === null && preview.liveSessionStartedAt !== undefined;
    return preview.status !== WAITING_FOR_LIVE && preview.spendMinor !== null && (preview.autoDetectLive !== true || detectedRoom);
  }, "invalid Auto LIVE or spend preview")
  .refine((value) => value.continuousSession?.waitingForLive !== true || (supportsAutoWaitingForLive(value.clientId) &&
    value.evidenceMode === VERIFIED_ROOM_SPEND_TREND && value.continuousSession.status === "ARMED"),
    "only a scoped armed session can be waiting for LIVE")
  .refine((value) => value.continuousSession?.autoDetectLive !== true || (supportsAutoWaitingForLive(value.clientId) &&
    (value.evidenceMode === VERIFIED_ROOM_SPEND_TREND || value.continuousSession.status === "STOPPED") && value.strategy === "continuous"),
    "LIVE detection requires an exact hybrid session")
  .refine((value) => value.continuousSession?.allowExhaustedRecovery !== true || value.continuousSession.autoDetectLive === true,
    "exhausted budget recovery requires LIVE detection authorization")
  .refine((value) => value.continuousSession?.keepAutoAcrossRooms !== true || value.continuousSession.autoDetectLive === true,
    "keeping Auto across rooms requires LIVE detection authorization");

const budgetAutoExactArmInputSchema = z.object({
  expectedCampaignId: tiktokNumericId,
  expectedBudgetMinor: positiveMinor,
  expectedPolicyRevision: positiveMinor,
}).strict();
const budgetAutoBaseArmInputSchema = budgetAutoExactArmInputSchema.extend({
  nativeAutoOff: z.literal(true),
  noConcurrentChanges: z.literal(true),
});
const budgetAutoVerifiedContinuousArmInputSchema = budgetAutoBaseArmInputSchema.extend({ expectedLiveSessionId: tiktokNumericId });
const budgetAutoVerifiedRoomSpendTrendArmInputSchema = budgetAutoVerifiedContinuousArmInputSchema.extend({
  evidenceMode: z.literal(VERIFIED_ROOM_SPEND_TREND), expectedLiveSessionId: tiktokNumericId.nullable(), autoDetectLive: z.literal(true).optional(),
  allowExhaustedRecovery: z.literal(true).optional(),
  keepAutoAcrossRooms: z.literal(true).optional(),
}).refine((value) => value.allowExhaustedRecovery !== true || value.autoDetectLive === true, "exhausted budget recovery requires LIVE detection authorization")
  .refine((value) => value.keepAutoAcrossRooms !== true || value.autoDetectLive === true, "keeping Auto across rooms requires LIVE detection authorization");
const budgetAutoSpendTrendArmInputSchema = budgetAutoExactArmInputSchema.extend({ evidenceMode: z.literal("spend-trend") });
const budgetAutoPpanContinuousArmInputSchema = z.union([budgetAutoVerifiedContinuousArmInputSchema, budgetAutoSpendTrendArmInputSchema]);
const budgetAutoArmInputSchema = budgetAutoBaseArmInputSchema.extend({ durationMinutes: z.number().int().min(10).max(120) });
const budgetAutoArmResultSchema = z.object({ grantId: operationId, expiresAt: instant });
const budgetAutoContinuousArmResultSchema = z.object({ sessionId: operationId, startedAt: instant });
const budgetAutoStopResultSchema = z.object({ stopped: z.boolean() });

export const budgetPreparationSchema = z.object({
  operationId,
  mode: commandMode,
  campaignId: id,
  currentBudgetMinor: positiveMinor,
  targetBudgetMinor: positiveMinor,
  projectedClientSpendMinor: positiveMinor,
  cap: capSchema,
  expiresAt: instant,
}).refine((value) => (
  value.currentBudgetMinor !== value.targetBudgetMinor
  && value.targetBudgetMinor <= value.cap.campaignCapMinor
  && value.projectedClientSpendMinor >= value.targetBudgetMinor
  && value.projectedClientSpendMinor <= value.cap.clientDailyCapMinor
  && !value.cap.locked
), "invalid prepared budget review");

const budgetOutcomeFields = {
  operationId,
  observedBudgetMinor: positiveMinor.nullable(),
};
const confirmationStatus = z.enum([
  "SIMULATED", "PROCESSING", "NOT_SENT", "PROVIDER_REJECTED", "APPLIED_VERIFIED", "OUTCOME_UNKNOWN",
]);

export const budgetConfirmationSchema = z.object({
  ...budgetOutcomeFields,
  status: confirmationStatus,
}).refine((value) => value.status !== "APPLIED_VERIFIED" || value.observedBudgetMinor !== null, "verification needs an observed budget");

export const budgetOperationSchema = z.object({
  ...budgetOutcomeFields,
  status: z.enum([...confirmationStatus.options, "PREPARED"]),
}).refine((value) => value.status !== "APPLIED_VERIFIED" || value.observedBudgetMinor !== null, "verification needs an observed budget");

export type AutomationBudgetStatus = z.infer<typeof budgetStatusSchema>;
export type AutomationBudgetPreparation = z.infer<typeof budgetPreparationSchema>;
export type AutomationBudgetOperation = z.infer<typeof budgetOperationSchema>;
export type BudgetCapInput = z.infer<typeof budgetCapInputSchema>;
export type BudgetCapResult = z.infer<typeof budgetCapResultSchema>;
export type BudgetCapStatus = Pick<AutomationBudgetStatus, "clientId" | "cap" | "capEditAllowed">;
export type BudgetAutoStatus = z.infer<typeof budgetAutoStatusSchema>;
export type BudgetAutoArmInput = z.infer<typeof budgetAutoArmInputSchema>;
export type BudgetAutoContinuousArmInput = z.infer<typeof budgetAutoPpanContinuousArmInputSchema> | BudgetAutoVerifiedRoomSpendTrendArmInput;
export type BudgetAutoVerifiedContinuousArmInput = z.infer<typeof budgetAutoVerifiedContinuousArmInputSchema>;
export type BudgetAutoVerifiedRoomSpendTrendArmInput = z.infer<typeof budgetAutoVerifiedRoomSpendTrendArmInputSchema>;
export type BudgetAutoSpendTrendArmInput = z.infer<typeof budgetAutoSpendTrendArmInputSchema>;
export type BudgetPrepareInput = {
  expectedCampaignId: string;
  expectedBudgetMinor: number;
  targetBudgetMinor: number;
};

function budgetPath(clientId: BudgetCapClientId): string {
  if (clientId === PILOT_BUDGET_CLIENT_ID) return "/automation/budget";
  if (isAdditionalBudgetCapClientId(clientId)) return `/automation/budget/${clientId}`;
  throw new Error("Invalid budget scope");
}

function capPath(clientId: AdditionalBudgetCapClientId): string {
  if (isAdditionalBudgetCapClientId(clientId)) return `/automation/budget/cap/${clientId}`;
  throw new Error("Invalid budget cap scope");
}

export function fetchBudgetStatus(signal?: AbortSignal, clientId: BudgetCapClientId = PILOT_BUDGET_CLIENT_ID) {
  return request(budgetStatusSchema.refine((status) => status.clientId === clientId, "unexpected Creator scope"), "Automation budget status", () =>
    http.get(`${budgetPath(clientId)}/status`, { signal }),
  );
}

export function fetchBudgetAutoStatus(clientId: BudgetCapClientId, signal?: AbortSignal) {
  return request(budgetAutoStatusSchema.refine((value) => value.clientId === clientId, "unexpected Creator scope"), "Automation Auto status", () =>
    http.get(`${budgetPath(clientId)}/auto/status`, { signal, params: { view: "detect-live" } }),
  );
}

export function fetchBudgetAutoOverviewStatus(clientId: BudgetCapClientId, signal?: AbortSignal) {
  return request(budgetAutoStatusSchema.refine((value) => value.clientId === clientId && value.overviewState !== undefined, "unexpected Creator overview scope"),
    "Automation Auto overview status", () => http.get(`${budgetPath(clientId)}/auto/status`, { signal, params: { view: "summary" } }));
}

export function fetchAdditionalBudgetCapStatus(clientId: AdditionalBudgetCapClientId, signal?: AbortSignal) {
  return request(additionalBudgetCapStatusSchema.refine((status) => status.clientId === clientId, "unexpected Creator scope"), "Creator budget cap status", () =>
    http.get(capPath(clientId), { signal }),
  );
}

/** The operator has to explicitly confirm the reviewed, account-scoped Auto window. */
export function armBudgetAuto(clientId: BudgetCapClientId, input: BudgetAutoArmInput) {
  return request(budgetAutoArmResultSchema, "Automation Auto arm", () => {
    if (requiresVerifiedRoomSpendTrendAuto(clientId)) throw new Error("Continuous verified-room spend-trend Auto is required");
    return http.post(`${budgetPath(clientId)}/auto/arm`, budgetAutoArmInputSchema.parse(input));
  });
}

export function stopBudgetAuto(clientId: BudgetCapClientId, grantId: string) {
  return request(budgetAutoStopResultSchema, "Automation Auto stop", () =>
    http.post(`${budgetPath(clientId)}/auto/stop`, { grantId: operationId.parse(grantId) }),
  );
}

/** Continuous authorization must use the evidence mode permitted for this exact Creator. */
export function armBudgetAutoContinuous(clientId: BudgetCapClientId, input: BudgetAutoContinuousArmInput) {
  return request(budgetAutoContinuousArmResultSchema, "Continuous Auto arm", () => {
    if (!isContinuousBudgetClientId(clientId)) throw new Error("Invalid continuous Auto scope");
    const explicitHybrid = "evidenceMode" in input && input.evidenceMode === VERIFIED_ROOM_SPEND_TREND;
    const body = explicitHybrid || clientId === NNSHOP_CAP_CLIENT_ID || requiresVerifiedRoomSpendTrendAuto(clientId) ? budgetAutoVerifiedRoomSpendTrendArmInputSchema.parse(input)
      : clientId === SRIHIW_CAP_CLIENT_ID ? budgetAutoSpendTrendArmInputSchema.parse(input) : budgetAutoPpanContinuousArmInputSchema.parse(input);
    return http.post(`${budgetPath(clientId)}/auto/arm`, body);
  });
}

export function stopBudgetAutoContinuous(clientId: BudgetCapClientId, sessionId: string) {
  return request(budgetAutoStopResultSchema, "Continuous Auto stop", () => {
    if (!isContinuousBudgetClientId(clientId)) throw new Error("Invalid continuous Auto scope");
    return http.post(`${budgetPath(clientId)}/auto/stop`, { sessionId: operationId.parse(sessionId) });
  });
}

export const armPpanBudgetAutoContinuous = (input: BudgetAutoContinuousArmInput) => armBudgetAutoContinuous(PILOT_BUDGET_CLIENT_ID, input);
export const stopPpanBudgetAutoContinuous = (sessionId: string) => stopBudgetAutoContinuous(PILOT_BUDGET_CLIENT_ID, sessionId);

/** Deliberate user action only; a failed response is reconciled with GET, never retried here. */
export function changeBudgetCap(clientId: BudgetCapClientId, input: BudgetCapInput) {
  return request(budgetCapResultSchema, "Automation budget cap", () => {
    const body = budgetCapInputSchema.parse(input);
    if (isAdditionalBudgetCapClientId(clientId)) return http.post(capPath(clientId), body);
    if (clientId === PILOT_BUDGET_CLIENT_ID && body.expectedRevision > 0) return http.post("/automation/budget/cap", body);
    throw new Error("Invalid cap change scope");
  });
}

/** Deliberate user action only. The shared HTTP client does not retry POST. */
export function prepareBudgetChange(input: BudgetPrepareInput, clientId: BudgetCapClientId = PILOT_BUDGET_CLIENT_ID) {
  return request(budgetPreparationSchema, "Automation budget review", () =>
    http.post(`${budgetPath(clientId)}/prepare`, input),
  );
}

/** Never re-send after a transport failure; use readBudgetOperation instead. */
export function confirmBudgetChange(id: string, clientId: BudgetCapClientId = PILOT_BUDGET_CLIENT_ID) {
  return request(budgetConfirmationSchema, "Automation budget result", () =>
    http.post(`${budgetPath(clientId)}/confirm`, {
      operationId: operationId.parse(id), nativeAutoOff: true, noConcurrentChanges: true,
    }),
  );
}

export function readBudgetOperation(id: string, signal?: AbortSignal, clientId: BudgetCapClientId = PILOT_BUDGET_CLIENT_ID) {
  return request(budgetOperationSchema, "Automation budget result", () =>
    http.get(`${budgetPath(clientId)}/operations/${operationId.parse(id)}`, { signal }),
  );
}
