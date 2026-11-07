import { z } from "zod";
import { PILOT_BUDGET_CLIENT_ID } from "./automation";
import { http, request } from "./client";

const instant = z.string().datetime({ offset: true });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const operationId = z.string().uuid();
const positiveMinor = z.number().int().safe().positive();
const commandMode = z.enum(["dry-run", "live"]);
export const SRIHIW_CAP_CLIENT_ID = "srihiw";
export const NNSHOP_CAP_CLIENT_ID = "nnshop5719";
export const ASHOP_CAP_CLIENT_ID = "ashopbytheta";
const extraBudgetIds = [SRIHIW_CAP_CLIENT_ID, NNSHOP_CAP_CLIENT_ID, ASHOP_CAP_CLIENT_ID] as const;
const budgetIds = [PILOT_BUDGET_CLIENT_ID, ...extraBudgetIds] as const;
export type AdditionalBudgetCapClientId = typeof extraBudgetIds[number];
export type BudgetCapClientId = typeof budgetIds[number];
export function isAdditionalBudgetCapClientId(value: string): value is AdditionalBudgetCapClientId {
  return extraBudgetIds.some((clientId) => clientId === value);
}
export function isBudgetCapClientId(value: string): value is BudgetCapClientId {
  return value === PILOT_BUDGET_CLIENT_ID || isAdditionalBudgetCapClientId(value);
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
  currentBudgetMinor: positiveMinor,
  spendMinor: z.number().int().safe().nonnegative(),
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
  grant: z.object({ grantId: operationId, status: autoStatusCode, expiresAt: instant }).nullable(),
  preview: autoPreviewSchema.nullable(),
  blockers: z.array(autoStatusCode).max(24),
  canArm: z.boolean().optional(),
  canStop: z.boolean().optional(),
});

const budgetAutoArmInputSchema = z.object({
  expectedCampaignId: z.string().regex(/^[1-9]\d{5,30}$/),
  expectedBudgetMinor: positiveMinor,
  expectedPolicyRevision: positiveMinor,
  durationMinutes: z.number().int().min(10).max(120),
  nativeAutoOff: z.literal(true),
  noConcurrentChanges: z.literal(true),
}).strict();
const budgetAutoArmResultSchema = z.object({ grantId: operationId, expiresAt: instant });
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
    http.get(`${budgetPath(clientId)}/auto/status`, { signal }),
  );
}

export function fetchAdditionalBudgetCapStatus(clientId: AdditionalBudgetCapClientId, signal?: AbortSignal) {
  return request(additionalBudgetCapStatusSchema.refine((status) => status.clientId === clientId, "unexpected Creator scope"), "Creator budget cap status", () =>
    http.get(capPath(clientId), { signal }),
  );
}

/** The operator has to explicitly confirm the reviewed, account-scoped Auto window. */
export function armBudgetAuto(clientId: BudgetCapClientId, input: BudgetAutoArmInput) {
  return request(budgetAutoArmResultSchema, "Automation Auto arm", () =>
    http.post(`${budgetPath(clientId)}/auto/arm`, budgetAutoArmInputSchema.parse(input)),
  );
}

export function stopBudgetAuto(clientId: BudgetCapClientId, grantId: string) {
  return request(budgetAutoStopResultSchema, "Automation Auto stop", () =>
    http.post(`${budgetPath(clientId)}/auto/stop`, { grantId: operationId.parse(grantId) }),
  );
}

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
