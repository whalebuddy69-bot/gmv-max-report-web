import { z } from "zod";
import { PILOT_BUDGET_CLIENT_ID } from "./automation";
import { http, request } from "./client";

const instant = z.string().datetime({ offset: true });
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const operationId = z.string().uuid();
const positiveMinor = z.number().int().safe().positive();
const commandMode = z.enum(["dry-run", "live"]);
const capSchema = z.object({
  revision: z.number().int().safe().positive(),
  campaignCapMinor: positiveMinor,
  clientDailyCapMinor: positiveMinor,
  readAt: instant,
  locked: z.boolean(),
});

export const budgetStatusSchema = z.object({
  clientId: id,
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

export const SRIHIW_CAP_CLIENT_ID = "srihiw";
const srihiwBudgetCapStatusSchema = z.object({
  clientId: z.literal(SRIHIW_CAP_CLIENT_ID),
  cap: capSchema.nullable(),
  capEditAllowed: z.boolean().default(false),
});
const SRIHIW_CAP_PATH = "/automation/budget/cap/srihiw";

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
export type BudgetCapClientId = typeof PILOT_BUDGET_CLIENT_ID | typeof SRIHIW_CAP_CLIENT_ID;
export type BudgetPrepareInput = {
  expectedCampaignId: string;
  expectedBudgetMinor: number;
  targetBudgetMinor: number;
};

function budgetPath(clientId: BudgetCapClientId): string {
  if (clientId === PILOT_BUDGET_CLIENT_ID) return "/automation/budget";
  if (clientId === SRIHIW_CAP_CLIENT_ID) return "/automation/budget/srihiw";
  throw new Error("Invalid budget scope");
}

export function fetchBudgetStatus(signal?: AbortSignal, clientId: BudgetCapClientId = PILOT_BUDGET_CLIENT_ID) {
  return request(budgetStatusSchema.refine((status) => status.clientId === clientId, "unexpected Creator scope"), "Automation budget status", () =>
    http.get(`${budgetPath(clientId)}/status`, { signal }),
  );
}

export function fetchSrihiwBudgetCapStatus(signal?: AbortSignal) {
  return request(srihiwBudgetCapStatusSchema, "Srihiw budget cap status", () =>
    http.get(SRIHIW_CAP_PATH, { signal }),
  );
}

/** Deliberate user action only; a failed response is reconciled with GET, never retried here. */
export function changeBudgetCap(clientId: BudgetCapClientId, input: BudgetCapInput) {
  return request(budgetCapResultSchema, "Automation budget cap", () => {
    const body = budgetCapInputSchema.parse(input);
    if (clientId === SRIHIW_CAP_CLIENT_ID) return http.post(SRIHIW_CAP_PATH, body);
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
