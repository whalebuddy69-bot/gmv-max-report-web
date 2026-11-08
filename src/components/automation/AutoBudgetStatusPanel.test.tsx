import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PILOT_BUDGET_CLIENT_ID } from "@/api/automation";
import { armBudgetAuto, armBudgetAutoContinuous, armPpanBudgetAutoContinuous, ASHOP_CAP_CLIENT_ID, budgetAutoStatusSchema, fetchBudgetAutoStatus, NNSHOP_CAP_CLIENT_ID, SRIHIW_CAP_CLIENT_ID, stopBudgetAuto, stopBudgetAutoContinuous, stopPpanBudgetAutoContinuous, type BudgetAutoStatus } from "@/api/automationBudget";
import { http } from "@/api/client";
import { AutoBudgetControls, AutoBudgetStatusBody, getAutoArmPreview } from "./AutoBudgetStatusPanel";

const observedAt = "2026-03-06T01:00:00.000Z";
const now = Date.parse(observedAt) + 2_000;
const status = {
  clientId: PILOT_BUDGET_CLIENT_ID,
  mode: "shadow",
  grant: null,
  preview: {
    status: "WOULD_INCREASE", campaignId: "sample-campaign", currentBudgetMinor: 800_000,
    spendMinor: 650_000, thresholdMinor: 640_000, targetBudgetMinor: 960_000,
    projectedClientSpendMinor: 1_000_000, policyRevision: 2, observedAt,
  },
  blockers: ["NATIVE_AUTO_UNVERIFIED", "SPEND_WATERMARK_MISSING", "LIVE_DELIVERY_UNVERIFIED"],
} satisfies BudgetAutoStatus;
const sampleNumericCampaign = "1234567890123456";
const sampleLiveSessionId = "2234567890123456";
const grantId = "5dc44ae6-cb1b-41a7-93bc-07805915653a";
const expiresAt = "2026-03-06T01:30:00.000Z";
const sessionId = "6dc44ae6-cb1b-41a7-93bc-07805915653a";
const continuous = {
  ...status,
  strategy: "continuous",
  mode: "live",
  blockers: [],
  canArm: true,
  preview: { ...status.preview, campaignId: sampleNumericCampaign, liveSessionId: sampleLiveSessionId },
  continuousSession: null,
} satisfies BudgetAutoStatus;
const spendTrend = {
  ...continuous, evidenceMode: "spend-trend", preview: { ...continuous.preview, liveSessionId: null },
} satisfies BudgetAutoStatus;

afterEach(() => vi.restoreAllMocks());

describe("read-only Auto budget panel", () => {
  it("labels the calculated proposal and blockers without any button or live claim", () => {
    const html = renderToStaticMarkup(<AutoBudgetStatusBody data={status} campaignId={status.preview.campaignId} now={now} />);
    expect(html).toContain("ประเมินอย่างเดียว · ไม่เพิ่มงบ");
    expect(html).toContain("฿6,400.00");
    expect(html).toContain("฿9,600.00");
    expect(html).toContain("฿10,000.00");
    expect(html).toContain("ไม่ใช่เวลาที่ TikTok อัปเดตยอดใช้");
    expect(html).toContain("ยังยืนยันไม่ได้ว่า Auto Budget ของ TikTok ปิดอยู่");
    expect(html).toContain("ยังยืนยันไม่ได้ว่ากำลังไลฟ์และแคมเปญกำลังส่งโฆษณา");
    expect(html).not.toContain("<button");
  });

  it("does not display old, future, or foreign campaign numbers", () => {
    for (const [campaignId, clock] of [["other-campaign", now], [null, now], [status.preview.campaignId, now + 181_000], [status.preview.campaignId, now - 8_000]] as const) {
      const html = renderToStaticMarkup(<AutoBudgetStatusBody data={status} campaignId={campaignId} now={clock} />);
      expect(html).toContain("ยังไม่มีผลประเมินล่าสุดของแคมเปญนี้");
      expect(html).not.toContain("฿9,600.00");
    }
  });

  it("rejects contradictory calculated amounts and doesn't leak unknown error labels", () => {
    expect(budgetAutoStatusSchema.safeParse(status).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...status, preview: { ...status.preview, targetBudgetMinor: 300 } }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...status, preview: { ...status.preview, projectedClientSpendMinor: 800_000 } }).success).toBe(false);
    const data = { ...status, mode: "disabled", preview: null, blockers: ["unknown-internal-tag"] } satisfies BudgetAutoStatus;
    const html = renderToStaticMarkup(<AutoBudgetStatusBody data={data} campaignId={null} now={now} />);
    expect(html).toContain("Auto ยังไม่เปิด");
    expect(html).toContain("มีเงื่อนไขความปลอดภัยที่ยังไม่ผ่าน");
    expect(html).not.toContain("unknown-internal-tag");
  });

  it("uses only scoped GET and rejects a response for another Creator", async () => {
    const srihiw = { ...status, clientId: SRIHIW_CAP_CLIENT_ID, mode: "disabled", preview: null };
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: status }).mockResolvedValueOnce({ data: srihiw }).mockResolvedValueOnce({ data: status });
    const post = vi.spyOn(http, "post");
    await expect(fetchBudgetAutoStatus(PILOT_BUDGET_CLIENT_ID)).resolves.toEqual(status);
    await expect(fetchBudgetAutoStatus(SRIHIW_CAP_CLIENT_ID)).resolves.toEqual(srihiw);
    await expect(fetchBudgetAutoStatus(SRIHIW_CAP_CLIENT_ID)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "/automation/budget/auto/status", "/automation/budget/srihiw/auto/status", "/automation/budget/srihiw/auto/status",
    ]);
    expect(post).not.toHaveBeenCalled();
  });

  it("requires explicit live capability, no blockers, and the exact fresh campaign even below the threshold", () => {
    const ready = { ...status, clientId: NNSHOP_CAP_CLIENT_ID, mode: "live", canArm: true, blockers: [],
      preview: { ...status.preview, campaignId: sampleNumericCampaign, status: "BELOW_THRESHOLD", spendMinor: 200,
        targetBudgetMinor: null, projectedClientSpendMinor: null },
    } satisfies BudgetAutoStatus;
    expect(getAutoArmPreview(ready, sampleNumericCampaign, now)).toEqual(ready.preview);
    expect(getAutoArmPreview(ready, "1234567890123457", now)).toBeNull();
    expect(getAutoArmPreview(ready, sampleNumericCampaign, now + 46_000)).toBeNull();
    expect(getAutoArmPreview({ ...ready, canArm: undefined }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, mode: "shadow" }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, blockers: ["SPEND_WATERMARK_MISSING"] }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, preview: { ...ready.preview, status: "CAMPAIGN_CAP_EXCEEDED" } }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, grant: { grantId, status: "ARMED", expiresAt } }, sampleNumericCampaign, now)).toBeNull();
  });

  it("renders no controls for unavailable permission, an unrelated Creator or an unauthorized stop", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const data = { ...status, mode: "live", blockers: [], preview: { ...status.preview, campaignId: sampleNumericCampaign } } satisfies BudgetAutoStatus;
    const props = { campaignId: sampleNumericCampaign, clientId: PILOT_BUDGET_CLIENT_ID, dataUpdatedAt: now, refresh: async () => null } as const;
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={data} />)).toBe("");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={{ ...data, canArm: true }} clientId={NNSHOP_CAP_CLIENT_ID} />)).toBe("");
    const visible = renderToStaticMarkup(<AutoBudgetControls {...props} data={{ ...data, canArm: true }} />);
    expect(visible).toContain("ตรวจเงื่อนไขก่อนเปิด Auto");
    expect(visible).not.toContain("ยืนยันเปิด Auto ใช้เงินจริง");
    const armed = { ...data, grant: { grantId, status: "ARMED", expiresAt } };
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={armed} />)).toBe("");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={{ ...armed, canStop: true }} />)).toContain("หยุดรอบ Auto");
  });

  it.each([NNSHOP_CAP_CLIENT_ID, ASHOP_CAP_CLIENT_ID] as const)("routes live commands to %s only and parses exact bodies", async (clientId) => {
    const scope = { ...status, clientId, canArm: false };
    const input = { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 40_000, expectedPolicyRevision: 2,
      durationMinutes: 30, nativeAutoOff: true, noConcurrentChanges: true } as const;
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: scope });
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { grantId, expiresAt } }).mockResolvedValueOnce({ data: { stopped: true } });
    await expect(fetchBudgetAutoStatus(clientId)).resolves.toEqual(scope);
    await expect(armBudgetAuto(clientId, input)).resolves.toEqual({ grantId, expiresAt });
    await expect(stopBudgetAuto(clientId, grantId)).resolves.toEqual({ stopped: true });
    await expect(armBudgetAuto(clientId, { ...input, durationMinutes: 121 })).rejects.toThrow();
    await expect(stopBudgetAuto(clientId, "some-other-record")).rejects.toThrow();
    expect(get.mock.calls.map(([path]) => path)).toEqual([`/automation/budget/${clientId}/auto/status`]);
    expect(post.mock.calls).toEqual([
      [`/automation/budget/${clientId}/auto/arm`, input],
      [`/automation/budget/${clientId}/auto/stop`, { grantId }],
    ]);
  });
});

describe("Ppan continuous Auto", () => {
  it("accepts exact Ppan status only and keeps old one-shot payloads valid", () => {
    const session = { sessionId, status: "ARMED", startedAt: observedAt, reason: null } as const;
    expect(budgetAutoStatusSchema.safeParse({ ...continuous, continuousSession: session }).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...continuous, clientId: NNSHOP_CAP_CLIENT_ID }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...status, continuousSession: session }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...continuous, continuousSession: { ...session, sessionId: "invalid" } }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...continuous, preview: { ...continuous.preview, liveSessionId: "invalid" } }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...status, clientId: ASHOP_CAP_CLIENT_ID }).success).toBe(true);
  });

  it("shows no-duration continuous review only when Ppan is explicitly permitted, with safety copy", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const props = { campaignId: sampleNumericCampaign, clientId: PILOT_BUDGET_CLIENT_ID, dataUpdatedAt: now, refresh: async () => null } as const;
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={{ ...continuous, canArm: false }} />)).toBe("");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={continuous} campaignId={null} />)).toBe("");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={{ ...continuous, preview: { ...continuous.preview, liveSessionId: null } }} />)).toBe("");
    const ui = renderToStaticMarkup(<AutoBudgetControls {...props} data={continuous} />);
    expect(ui).toContain("ตรวจเงื่อนไขก่อนเปิด Auto ต่อเนื่อง");
    expect(ui).not.toContain("10–120 นาที");
    expect(ui).not.toContain("ยืนยันเปิด Auto ต่อเนื่อง ใช้เงินจริง");
    const body = renderToStaticMarkup(<AutoBudgetStatusBody data={continuous} campaignId={sampleNumericCampaign} now={now} />);
    expect(body).toContain("ไม่จำกัดจำนวนครั้ง แต่ไม่เกินเพดานงบ");
    expect(body).toContain("หยุดเมื่อไม่พบแคมเปญที่เปิด Auto ไว้ หรือ LIVE จบหรือเปลี่ยนห้อง");
    const extra = { ...status, clientId: NNSHOP_CAP_CLIENT_ID, mode: "live", canArm: true, blockers: [], preview: continuous.preview } satisfies BudgetAutoStatus;
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={extra} clientId={NNSHOP_CAP_CLIENT_ID} />)).toContain("10–120 นาที");
  });

  it("shows an authorized emergency stop even if no campaign is observed, without offering to arm again", () => {
    const data = { ...continuous, canStop: true, continuousSession: { sessionId, startedAt: observedAt, status: "BLOCKED", reason: "CAMPAIGN_NOT_OBSERVED" } } satisfies BudgetAutoStatus;
    const props = { campaignId: null, clientId: PILOT_BUDGET_CLIENT_ID, dataUpdatedAt: now, refresh: async () => null } as const;
    const ui = renderToStaticMarkup(<AutoBudgetControls {...props} data={data} />);
    expect(ui).toContain("หยุด Auto ต่อเนื่อง");
    expect(ui).not.toContain("ตรวจเงื่อนไขก่อนเปิด Auto");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={{ ...data, canStop: false }} />)).toBe("");
    const body = renderToStaticMarkup(<AutoBudgetStatusBody data={data} campaignId={null} now={now} />);
    expect(body).toContain("ไม่พบแคมเปญที่เปิด Auto ไว้");
    expect(body).not.toContain("สิ้นสุดตามกำหนด");
  });

  it("uses fixed Ppan endpoints with no duration and stops by sessionId only", async () => {
    const input = { expectedCampaignId: sampleNumericCampaign, expectedLiveSessionId: sampleLiveSessionId, expectedBudgetMinor: 800_000, expectedPolicyRevision: 2,
      nativeAutoOff: true, noConcurrentChanges: true } as const;
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { sessionId, startedAt: observedAt } })
      .mockResolvedValueOnce({ data: { stopped: true } });
    await expect(armPpanBudgetAutoContinuous(input)).resolves.toEqual({ sessionId, startedAt: observedAt });
    await expect(stopPpanBudgetAutoContinuous(sessionId)).resolves.toEqual({ stopped: true });
    const withDuration = { ...input, durationMinutes: 30 };
    await expect(armPpanBudgetAutoContinuous(withDuration)).rejects.toThrow();
    await expect(armPpanBudgetAutoContinuous({ ...input, expectedLiveSessionId: "not-a-room" })).rejects.toThrow();
    await expect(stopPpanBudgetAutoContinuous("not-a-session")).rejects.toThrow();
    expect(post.mock.calls).toEqual([
      ["/automation/budget/auto/arm", input], ["/automation/budget/auto/stop", { sessionId }],
    ]);
  });

  it("uses a live spend-trend review only for the exact Ppan campaign and explains the proxy", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const props = { campaignId: sampleNumericCampaign, clientId: PILOT_BUDGET_CLIENT_ID, dataUpdatedAt: now, refresh: async () => null } as const;
    expect(budgetAutoStatusSchema.safeParse(spendTrend).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...spendTrend, clientId: NNSHOP_CAP_CLIENT_ID, strategy: "one-shot" }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...spendTrend, strategy: "one-shot" }).success).toBe(false);
    expect(getAutoArmPreview(spendTrend, sampleNumericCampaign, now)).toEqual(spendTrend.preview);
    expect(getAutoArmPreview({ ...spendTrend, evidenceMode: undefined }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview(spendTrend, null, now)).toBeNull();
    expect(getAutoArmPreview({ ...spendTrend, blockers: ["NATIVE_AUTO_CONFLICT"] }, sampleNumericCampaign, now)).toBeNull();
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={spendTrend} />)).toContain("ตรวจเงื่อนไขก่อนเปิด Auto ต่อเนื่อง");
    const waiting = { ...spendTrend, canArm: false, canStop: true, blockers: ["SPEND_TREND_PENDING"],
      continuousSession: { sessionId, startedAt: observedAt, status: "ARMED", reason: null } } satisfies BudgetAutoStatus;
    const html = renderToStaticMarkup(<AutoBudgetStatusBody data={waiting} campaignId={sampleNumericCampaign} now={now} />);
    expect(html).toContain("เทียบยอดใช้จาก TikTok ทุก 1 นาที");
    expect(html).toContain("สัญญาณแทนการยืนยัน LIVE");
    expect(html).toContain("รอให้ยอดใช้เพิ่มขึ้นจากรอบก่อนก่อนส่งคำสั่ง");
    expect(html).not.toContain("LIVE จบหรือเปลี่ยนห้อง");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={waiting} />)).toContain("หยุด Auto ต่อเนื่อง");
  });

  it("sends only the exact Ppan spend-trend authorization without invented confirmations", async () => {
    const input = { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 800_000,
      expectedPolicyRevision: 2, evidenceMode: "spend-trend" } as const;
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { sessionId, startedAt: observedAt } });
    await expect(armPpanBudgetAutoContinuous(input)).resolves.toEqual({ sessionId, startedAt: observedAt });
    const withRoom = { ...input, expectedLiveSessionId: sampleLiveSessionId };
    const withAttestation = { ...input, nativeAutoOff: true, noConcurrentChanges: true };
    await expect(armPpanBudgetAutoContinuous(withRoom)).rejects.toThrow();
    await expect(armPpanBudgetAutoContinuous(withAttestation)).rejects.toThrow();
    expect(post.mock.calls).toEqual([["/automation/budget/auto/arm", input]]);
  });

  it("accepts Srihiw spend-trend only and never routes its continuous commands through Ppan", async () => {
    const scoped = { ...spendTrend, clientId: SRIHIW_CAP_CLIENT_ID } satisfies BudgetAutoStatus;
    expect(budgetAutoStatusSchema.safeParse(scoped).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...scoped, evidenceMode: undefined }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...scoped, clientId: ASHOP_CAP_CLIENT_ID }).success).toBe(false);
    expect(getAutoArmPreview(scoped, sampleNumericCampaign, now)).toEqual(scoped.preview);
    expect(getAutoArmPreview({ ...scoped, evidenceMode: undefined }, sampleNumericCampaign, now)).toBeNull();
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { sessionId, startedAt: observedAt } })
      .mockResolvedValueOnce({ data: { stopped: true } });
    const input = { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 800_000, expectedPolicyRevision: 2, evidenceMode: "spend-trend" } as const;
    await expect(armBudgetAutoContinuous(SRIHIW_CAP_CLIENT_ID, input)).resolves.toEqual({ sessionId, startedAt: observedAt });
    await expect(stopBudgetAutoContinuous(SRIHIW_CAP_CLIENT_ID, sessionId)).resolves.toEqual({ stopped: true });
    await expect(armBudgetAutoContinuous(SRIHIW_CAP_CLIENT_ID, { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 800_000,
      expectedPolicyRevision: 2, expectedLiveSessionId: sampleLiveSessionId, nativeAutoOff: true, noConcurrentChanges: true })).rejects.toThrow();
    await expect(stopBudgetAutoContinuous(NNSHOP_CAP_CLIENT_ID, sessionId)).rejects.toThrow();
    expect(post.mock.calls).toEqual([["/automation/budget/srihiw/auto/arm", input], ["/automation/budget/srihiw/auto/stop", { sessionId }]]);
  });
});
