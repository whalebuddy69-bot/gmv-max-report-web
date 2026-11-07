import type { AutomationClient } from "@/api/automation";
import { SRIHIW_CAP_CLIENT_ID, type AutomationBudgetOperation, type AutomationBudgetPreparation, type AutomationBudgetStatus, type BudgetCapClientId, type BudgetCapInput, type BudgetCapResult, type BudgetCapStatus, type BudgetPrepareInput } from "@/api/automationBudget";
import { bangkokDay, isFreshAutomationClient } from "./automation";

export type BudgetDirection = "increase" | "decrease";
export type BudgetCapReview = BudgetCapInput & { currentCapMinor: number | null };
const MAX_CAP_AGE_MS = 45_000;
const MAX_CLIENT_AGE_MS = 90_000;
const MAX_CLOCK_SKEW_MS = 5_000;
const bahtNumber = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });

export function formatBudgetBaht(minor: number): string {
  const amount = BigInt(minor);
  return `฿${bahtNumber.format(amount / 100n)}.${String(amount % 100n).padStart(2, "0")}`;
}

/** Avoid floating-point money and ambiguous notation (e.g. exponential or misplaced commas). */
export function parseBudgetBaht(value: string): number | null {
  const input = value.trim();
  if (input.length > 25 || !/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(input)) return null;
  const [whole = "0", fraction = ""] = input.replaceAll(",", "").split(".");
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

export function freshBudgetCap(status: Pick<BudgetCapStatus, "cap"> | null, now: number): boolean {
  if (!status?.cap || !Number.isFinite(now)) return false;
  const readAt = Date.parse(status.cap.readAt);
  const age = now - readAt;
  return Number.isFinite(readAt) && age >= -MAX_CLOCK_SKEW_MS && age <= MAX_CAP_AGE_MS
    && bangkokDay(now) === bangkokDay(readAt);
}

/** Policy editing is independent of permission to send real TikTok budget commands. */
export function canEditBudgetCap(status: BudgetCapStatus | null, clientId: BudgetCapClientId, now: number): boolean {
  if (status?.clientId !== clientId || status.capEditAllowed !== true) return false;
  if (!status.cap) return clientId === SRIHIW_CAP_CLIENT_ID;
  return !status.cap.locked && status.cap.revision < Number.MAX_SAFE_INTEGER
    && status.cap.campaignCapMinor === status.cap.clientDailyCapMinor && freshBudgetCap(status, now);
}

export function canConfirmBudgetCap(review: BudgetCapReview, status: BudgetCapStatus | null, clientId: BudgetCapClientId, now: number): boolean {
  return canEditBudgetCap(status, clientId, now) && (status?.cap?.revision ?? 0) === review.expectedRevision
    && (status?.cap?.campaignCapMinor ?? null) === review.currentCapMinor
    && Number.isSafeInteger(review.capMinor) && review.capMinor > 0 && review.capMinor !== review.currentCapMinor;
}

export function budgetCapResultMatches(result: BudgetCapResult, input: BudgetCapInput): boolean {
  return result.revision === input.expectedRevision + 1 && result.capMinor === input.capMinor;
}

export function canPrepareBudget(status: AutomationBudgetStatus | null, client: AutomationClient | null, now: number): boolean {
  if (!status?.canPrepare || status.mode === "disabled" || !status.cap || status.cap.locked || !client?.campaign
    || client.clientId !== status.clientId || !isFreshAutomationClient(client, now) || !freshBudgetCap(status, now)
    || client.campaign.spendMinor === null || client.observedAt === null) return false;
  const age = now - Date.parse(client.observedAt);
  return age >= -MAX_CLOCK_SKEW_MS && age <= MAX_CLIENT_AGE_MS;
}

export function validDirection(targetMinor: number, currentMinor: number, direction: BudgetDirection): boolean {
  return direction === "increase" ? targetMinor > currentMinor : targetMinor < currentMinor;
}

export function preparationMatchesRequest(
  preparation: AutomationBudgetPreparation,
  input: BudgetPrepareInput,
  status: AutomationBudgetStatus,
  now: number,
): boolean {
  return preparation.campaignId === input.expectedCampaignId
    && preparation.currentBudgetMinor === input.expectedBudgetMinor
    && preparation.targetBudgetMinor === input.targetBudgetMinor
    && preparation.mode === status.mode
    && preparation.cap.revision === status.cap?.revision
    && preparation.cap.campaignCapMinor === status.cap.campaignCapMinor
    && preparation.cap.clientDailyCapMinor === status.cap.clientDailyCapMinor
    && Date.parse(preparation.expiresAt) > now;
}

export function canConfirmBudget(
  preparation: AutomationBudgetPreparation,
  status: AutomationBudgetStatus | null,
  client: AutomationClient | null,
  now: number,
): boolean {
  return !!status && !!client?.campaign && canPrepareBudget(status, client, now)
    && preparationMatchesRequest(preparation, {
      expectedCampaignId: client.campaign.campaignId,
      expectedBudgetMinor: client.campaign.dailyBudgetMinor,
      targetBudgetMinor: preparation.targetBudgetMinor,
    }, status, now);
}

export function isTerminalBudgetResult(status: AutomationBudgetOperation["status"]): boolean {
  return status === "APPLIED_VERIFIED" || status === "SIMULATED" || status === "NOT_SENT" || status === "PROVIDER_REJECTED";
}

export function budgetResultMatches(
  result: AutomationBudgetOperation,
  operationId: string,
  expectedTarget: number | null,
  expectedMode: AutomationBudgetPreparation["mode"] | null,
): boolean {
  if (result.operationId !== operationId) return false;
  if (result.status === "APPLIED_VERIFIED") {
    return expectedMode !== "dry-run" && result.observedBudgetMinor !== null
      && (expectedTarget === null || result.observedBudgetMinor === expectedTarget);
  }
  return result.status !== "SIMULATED" || expectedMode !== "live";
}
