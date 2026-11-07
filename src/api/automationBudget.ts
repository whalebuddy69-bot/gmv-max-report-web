import { z } from "zod";
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
}).refine((status) => !status.canPrepare || (
  status.mode !== "disabled" && status.cap !== null && !status.cap.locked
), "enabled action requires an unlocked, known policy");

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
export type BudgetPrepareInput = {
  expectedCampaignId: string;
  expectedBudgetMinor: number;
  targetBudgetMinor: number;
};

export function fetchBudgetStatus(signal?: AbortSignal) {
  return request(budgetStatusSchema, "Automation budget status", () =>
    http.get("/automation/budget/status", { signal }),
  );
}

/** Deliberate user action only. The shared HTTP client does not retry POST. */
export function prepareBudgetChange(input: BudgetPrepareInput) {
  return request(budgetPreparationSchema, "Automation budget review", () =>
    http.post("/automation/budget/prepare", input),
  );
}

/** Never re-send after a transport failure; use readBudgetOperation instead. */
export function confirmBudgetChange(id: string) {
  return request(budgetConfirmationSchema, "Automation budget result", () =>
    http.post("/automation/budget/confirm", {
      operationId: operationId.parse(id), nativeAutoOff: true, noConcurrentChanges: true,
    }),
  );
}

export function readBudgetOperation(id: string, signal?: AbortSignal) {
  return request(budgetOperationSchema, "Automation budget result", () =>
    http.get(`/automation/budget/operations/${operationId.parse(id)}`, { signal }),
  );
}
