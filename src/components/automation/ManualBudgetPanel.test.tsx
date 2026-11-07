import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PILOT_BUDGET_CLIENT_ID, type AutomationClient } from "@/api/automation";
import { budgetConfirmationSchema, budgetOperationSchema, budgetPreparationSchema, budgetStatusSchema, changeBudgetCap, confirmBudgetChange, fetchBudgetStatus, fetchSrihiwBudgetCapStatus, prepareBudgetChange, readBudgetOperation, SRIHIW_CAP_CLIENT_ID, type AutomationBudgetPreparation, type AutomationBudgetStatus } from "@/api/automationBudget";
import { http } from "@/api/client";
import { budgetCapResultMatches, budgetResultMatches, canConfirmBudget, canConfirmBudgetCap, canEditBudgetCap, canPrepareBudget, freshBudgetCap, isTerminalBudgetResult, parseBudgetBaht, preparationMatchesRequest, validDirection } from "@/lib/automationBudget";
import { BudgetCapEditor } from "./BudgetCapEditor";
import { BudgetOutcome } from "./ManualBudgetPanel";

const at = "2026-01-03T02:01:00.000Z";
const now = Date.parse(at);
const cap = { revision: 3, campaignCapMinor: 450_000, clientDailyCapMinor: 900_000, readAt: at, locked: false };
const operationId = "09c37d02-c9a7-45b3-9e2f-d73462091ccb";
const status: AutomationBudgetStatus = { clientId: PILOT_BUDGET_CLIENT_ID, canPrepare: true, capEditAllowed: false, mode: "dry-run", cap };
const campaign = { campaignId: "test-campaign", campaignName: "Synthetic", campaignStatus: "ACTIVE", currency: "THB", dailyBudgetMinor: 124_520, spendMinor: 40_012, targetRoi: null } as const;
const client: AutomationClient = {
  clientId: status.clientId, advertiserId: "test-advertiser", tiktokAccountId: "test-tiktok", displayName: "Synthetic Creator",
  reportingDate: "2026-01-03", access: "verified", observedAt: at, capMinor: null, campaign,
  actions: { start: false, pause: false, increaseBudget: false, decreaseBudget: false, auto: false },
};
const prepareInput = { expectedCampaignId: campaign.campaignId, expectedBudgetMinor: 124_520, targetBudgetMinor: 150_075 };
const prepared: AutomationBudgetPreparation = {
  operationId, mode: "dry-run", campaignId: campaign.campaignId, currentBudgetMinor: 124_520, targetBudgetMinor: 150_075,
  projectedClientSpendMinor: 213_000, cap, expiresAt: "2026-01-03T02:02:00.000Z",
};
const simulated = { operationId, status: "SIMULATED", observedBudgetMinor: null } as const;

afterEach(() => vi.restoreAllMocks());

describe("manual budget UI guardrails", () => {
  it("uses exact minor units and refuses ambiguous amounts", () => {
    expect(parseBudgetBaht(" 1,245.20 ")).toBe(124_520);
    expect(parseBudgetBaht("0.01")).toBe(1);
    expect(parseBudgetBaht("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    for (const amount of ["90071992547409.92", "1e5", "1.001", "1,2.00", "0", "-10", "NaN", "10 0", "00.20"]) {
      expect(parseBudgetBaht(amount)).toBeNull();
    }
    expect(validDirection(1, 1, "increase")).toBe(false);
    expect(validDirection(90, 100, "decrease")).toBe(true);
  });

  it("requires available recent campaign, spend, matching scope, operator permission and cap", () => {
    expect(canPrepareBudget(status, client, now)).toBe(true);
    expect(canPrepareBudget({ ...status, canPrepare: false }, client, now)).toBe(false);
    expect(canPrepareBudget({ ...status, cap: { ...cap, locked: true } }, client, now)).toBe(false);
    expect(canPrepareBudget(status, { ...client, clientId: "other-client" }, now)).toBe(false);
    expect(canPrepareBudget(status, { ...client, campaign: { ...campaign, spendMinor: null } }, now)).toBe(false);
    expect(canPrepareBudget(status, { ...client, observedAt: "2026-01-03T01:59:00.000Z" }, now)).toBe(false);
    expect(freshBudgetCap(status, now + 46_000)).toBe(false);
    expect(freshBudgetCap(status, now - 10_000)).toBe(false);
  });

  it("blocks confirmation on changed budget, policy, campaign, permission, mode or expiry", () => {
    expect(canConfirmBudget(prepared, status, client, now)).toBe(true);
    expect(canConfirmBudget(prepared, status, { ...client, campaign: { ...campaign, dailyBudgetMinor: 124_521 } }, now)).toBe(false);
    expect(canConfirmBudget(prepared, status, { ...client, campaign: { ...campaign, campaignId: "another-campaign" } }, now)).toBe(false);
    expect(canConfirmBudget(prepared, { ...status, cap: { ...cap, revision: 4 } }, client, now)).toBe(false);
    expect(canConfirmBudget(prepared, { ...status, mode: "live" }, client, now)).toBe(false);
    expect(canConfirmBudget(prepared, { ...status, canPrepare: false }, client, now)).toBe(false);
    expect(canConfirmBudget({ ...prepared, expiresAt: at }, status, client, now)).toBe(false);
    expect(preparationMatchesRequest({ ...prepared, targetBudgetMinor: 150_076 }, prepareInput, status, now)).toBe(false);
  });

  it("does not treat PROCESSING, PREPARED, or ambiguity as terminal", () => {
    for (const value of ["PROCESSING", "PREPARED", "OUTCOME_UNKNOWN"] as const) expect(isTerminalBudgetResult(value)).toBe(false);
    for (const value of ["APPLIED_VERIFIED", "SIMULATED", "NOT_SENT", "PROVIDER_REJECTED"] as const) expect(isTerminalBudgetResult(value)).toBe(true);
  });

  it("does not accept success for a wrong operation, readback amount or simulation mode", () => {
    const applied = { operationId, status: "APPLIED_VERIFIED", observedBudgetMinor: 150_075 } as const;
    expect(budgetResultMatches(applied, operationId, 150_075, "live")).toBe(true);
    expect(budgetResultMatches(applied, operationId, 150_076, "live")).toBe(false);
    expect(budgetResultMatches(applied, operationId, 150_075, "dry-run")).toBe(false);
    expect(budgetResultMatches(applied, "different-operation", 150_075, "live")).toBe(false);
    expect(budgetResultMatches(simulated, operationId, 150_075, "live")).toBe(false);
  });

  it("labels simulation, ambiguous and verified outcomes distinctly", () => {
    const simulation = renderToStaticMarkup(<BudgetOutcome operationId={operationId} result={simulated} />);
    expect(simulation).toContain("ไม่ได้แก้งบจริง");
    expect(simulation).not.toContain("ปรับงบสำเร็จและยืนยัน");
    const unknown = renderToStaticMarkup(<BudgetOutcome operationId={operationId} result={null} />);
    expect(unknown).toContain("อย่าส่งคำสั่งซ้ำ");
    const applied = renderToStaticMarkup(<BudgetOutcome operationId={operationId} result={{ operationId, status: "APPLIED_VERIFIED", observedBudgetMinor: 150_075 }} />);
    expect(applied).toContain("฿1,500.75");
    expect(applied).toContain("ยืนยันจาก TikTok แล้ว");
  });
});

describe("manual budget API contracts", () => {
  it("rejects inconsistent caps and success with no verification", () => {
    expect(budgetStatusSchema.safeParse({ ...status, mode: "disabled" }).success).toBe(false);
    expect(budgetStatusSchema.safeParse({ ...status, cap: null }).success).toBe(false);
    expect(budgetPreparationSchema.safeParse({ ...prepared, projectedClientSpendMinor: 900_001 }).success).toBe(false);
    expect(budgetPreparationSchema.safeParse({ ...prepared, targetBudgetMinor: 450_001 }).success).toBe(false);
    expect(budgetConfirmationSchema.safeParse({ operationId, status: "APPLIED_VERIFIED", observedBudgetMinor: null }).success).toBe(false);
    expect(budgetOperationSchema.safeParse({ operationId, status: "PREPARED", observedBudgetMinor: null }).success).toBe(true);
  });

  it("posts only exact prepare/confirm bodies and reads an uncertain outcome via GET", async () => {
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: status }).mockResolvedValueOnce({ data: simulated });
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: prepared }).mockRejectedValueOnce(new Error("simulated transport loss"));
    await expect(fetchBudgetStatus()).resolves.toEqual(status);
    await expect(prepareBudgetChange(prepareInput)).resolves.toEqual(prepared);
    await expect(confirmBudgetChange(operationId)).rejects.toThrow();
    await expect(readBudgetOperation(operationId)).resolves.toEqual(simulated);
    expect(post.mock.calls).toEqual([
      ["/automation/budget/prepare", prepareInput],
      ["/automation/budget/confirm", { operationId, nativeAutoOff: true, noConcurrentChanges: true }],
    ]);
    expect(get.mock.calls.map(([path]) => path)).toEqual(["/automation/budget/status", `/automation/budget/operations/${operationId}`]);
    await expect(readBudgetOperation("../unknown")).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("scopes Srihiw budget reads and deliberate writes without falling back to Ppan", async () => {
    const srihiw = { ...status, clientId: SRIHIW_CAP_CLIENT_ID, mode: "live" };
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: srihiw }).mockResolvedValueOnce({ data: simulated }).mockResolvedValueOnce({ data: status });
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { ...prepared, mode: "live" } }).mockRejectedValueOnce(new Error("transport loss"));
    await expect(fetchBudgetStatus(undefined, SRIHIW_CAP_CLIENT_ID)).resolves.toEqual(srihiw);
    await expect(prepareBudgetChange(prepareInput, SRIHIW_CAP_CLIENT_ID)).resolves.toMatchObject({ mode: "live" });
    await expect(confirmBudgetChange(operationId, SRIHIW_CAP_CLIENT_ID)).rejects.toThrow();
    await expect(readBudgetOperation(operationId, undefined, SRIHIW_CAP_CLIENT_ID)).resolves.toEqual(simulated);
    await expect(fetchBudgetStatus(undefined, SRIHIW_CAP_CLIENT_ID)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(post.mock.calls).toEqual([
      ["/automation/budget/srihiw/prepare", prepareInput],
      ["/automation/budget/srihiw/confirm", { operationId, nativeAutoOff: true, noConcurrentChanges: true }],
    ]);
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "/automation/budget/srihiw/status", `/automation/budget/srihiw/operations/${operationId}`, "/automation/budget/srihiw/status",
    ]);
  });
});

describe("website budget cap", () => {
  const singleCap = { ...cap, clientDailyCapMinor: cap.campaignCapMinor };
  const editable = { ...status, mode: "disabled", canPrepare: false, capEditAllowed: true, cap: singleCap } as const;
  const initialSrihiw = { clientId: SRIHIW_CAP_CLIENT_ID, capEditAllowed: true, cap: null } as const;
  const review = { expectedRevision: 3, currentCapMinor: 450_000, capMinor: 300_000 };

  it("requires explicit scope and fresh unlocked permission, independent of TikTok write mode", () => {
    expect(canEditBudgetCap(editable, PILOT_BUDGET_CLIENT_ID, now)).toBe(true);
    expect(canEditBudgetCap(status, PILOT_BUDGET_CLIENT_ID, now)).toBe(false);
    expect(canEditBudgetCap(editable, SRIHIW_CAP_CLIENT_ID, now)).toBe(false);
    expect(canEditBudgetCap({ ...editable, cap }, PILOT_BUDGET_CLIENT_ID, now)).toBe(false);
    expect(canEditBudgetCap({ ...editable, cap: { ...singleCap, locked: true } }, PILOT_BUDGET_CLIENT_ID, now)).toBe(false);
    expect(canEditBudgetCap(editable, PILOT_BUDGET_CLIENT_ID, now + 46_000)).toBe(false);
    expect(budgetStatusSchema.parse({ ...editable, capEditAllowed: undefined }).capEditAllowed).toBe(false);
  });

  it("blocks stale or same-amount confirmation and only permits revision zero for first Srihiw cap", () => {
    expect(canConfirmBudgetCap(review, editable, PILOT_BUDGET_CLIENT_ID, now)).toBe(true);
    expect(canConfirmBudgetCap(review, { ...editable, cap: { ...singleCap, revision: 4 } }, PILOT_BUDGET_CLIENT_ID, now)).toBe(false);
    expect(canConfirmBudgetCap({ ...review, capMinor: review.currentCapMinor }, editable, PILOT_BUDGET_CLIENT_ID, now)).toBe(false);
    const first = { expectedRevision: 0, currentCapMinor: null, capMinor: 75_050 };
    expect(canConfirmBudgetCap(first, initialSrihiw, SRIHIW_CAP_CLIENT_ID, now)).toBe(true);
    expect(canConfirmBudgetCap(first, { ...initialSrihiw, cap: singleCap }, SRIHIW_CAP_CLIENT_ID, now)).toBe(false);
    expect(canConfirmBudgetCap(first, { ...editable, cap: null }, PILOT_BUDGET_CLIENT_ID, now)).toBe(false);
    expect(budgetCapResultMatches({ revision: 1, capMinor: first.capMinor }, first)).toBe(true);
    expect(budgetCapResultMatches({ revision: 2, capMinor: first.capMinor }, first)).toBe(false);
    expect(budgetCapResultMatches({ revision: 1, capMinor: first.capMinor - 1 }, first)).toBe(false);
  });

  it("renders the approved first-cap editor without implying a TikTok budget change", () => {
    const props = { active: true, clientId: SRIHIW_CAP_CLIENT_ID, displayName: "Srihiw", loading: false, refreshStatus: async () => null } as const;
    const available = renderToStaticMarkup(<BudgetCapEditor {...props} status={initialSrihiw} />);
    expect(available).toContain("ยังไม่ได้ตั้งเพดานงบ");
    expect(available).toContain("ตั้งเพดานงบ</button>");
    expect(available).not.toContain("ยืนยันเพดานใหม่");
    const denied = renderToStaticMarkup(<BudgetCapEditor {...props} status={{ ...initialSrihiw, capEditAllowed: false }} />);
    expect(denied).not.toContain("ตั้งเพดานงบ</button>");
    const mismatched = renderToStaticMarkup(<BudgetCapEditor {...props} status={editable} />);
    expect(mismatched).not.toContain("แก้เพดานงบ");
  });

  it("sends only exact cap bodies, never repeats a lost response, and validates Srihiw scope", async () => {
    const first = { expectedRevision: 0, capMinor: 75_050 };
    const existing = { expectedRevision: 3, capMinor: 300_000 };
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: initialSrihiw }).mockResolvedValueOnce({ data: editable });
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { capMinor: 300_000, revision: 4 } }).mockRejectedValueOnce(new Error("transport loss"));
    await expect(fetchSrihiwBudgetCapStatus()).resolves.toEqual(initialSrihiw);
    await expect(changeBudgetCap(PILOT_BUDGET_CLIENT_ID, existing)).resolves.toEqual({ capMinor: 300_000, revision: 4 });
    await expect(changeBudgetCap(SRIHIW_CAP_CLIENT_ID, first)).rejects.toThrow();
    await expect(changeBudgetCap(PILOT_BUDGET_CLIENT_ID, first)).rejects.toThrow();
    await expect(changeBudgetCap(SRIHIW_CAP_CLIENT_ID, { ...first, capMinor: -1 })).rejects.toThrow();
    await expect(fetchSrihiwBudgetCapStatus()).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(post.mock.calls).toEqual([
      ["/automation/budget/cap", existing], ["/automation/budget/cap/srihiw", first],
    ]);
    expect(get.mock.calls.map(([path]) => path)).toEqual(["/automation/budget/cap/srihiw", "/automation/budget/cap/srihiw"]);
  });
});
