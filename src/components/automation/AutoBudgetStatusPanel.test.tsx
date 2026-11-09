import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PILOT_BUDGET_CLIENT_ID } from "@/api/automation";
import { armBudgetAuto, armBudgetAutoContinuous, armPpanBudgetAutoContinuous, ASHOP_CAP_CLIENT_ID, BUBPA_CAP_CLIENT_ID, budgetAutoStatusSchema, fetchBudgetAutoStatus, LIVE_WAITING_FOR_SPEND, MYUSHOP_CAP_CLIENT_ID, NNSHOP_CAP_CLIENT_ID, SRIHIW_CAP_CLIENT_ID, stopBudgetAuto, stopBudgetAutoContinuous, stopPpanBudgetAutoContinuous, VERIFIED_ROOM_SPEND_TREND, WAITING_FOR_LIVE, type BudgetAutoStatus, type BudgetCapClientId } from "@/api/automationBudget";
import { http } from "@/api/client";
import { AutoBudgetControls, AutoBudgetStatusBody, AutoBudgetStatusPanel, autoFormSwitchState, buildAutoArmDraft, getAutoArmPreview } from "./AutoBudgetStatusPanel";

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

  it("routes the remaining one-shot commands to nnshop5719 only and parses exact bodies", async () => {
    const clientId = NNSHOP_CAP_CLIENT_ID;
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
  it("keeps Auto in a single compact row by default, without hiding an authorized emergency stop", () => {
    const queryClient = new QueryClient();
    const post = vi.spyOn(http, "post");
    queryClient.setQueryData(["automation", "budget-auto-overview", 7, PILOT_BUDGET_CLIENT_ID], {
      ...spendTrend, canArm: false, canStop: true, preview: null, overviewState: "on",
      continuousSession: { sessionId, status: "ARMED", startedAt: observedAt },
    } satisfies BudgetAutoStatus);
    const html = renderToStaticMarkup(<QueryClientProvider client={queryClient}>
      <AutoBudgetStatusPanel userId={7} clientId={PILOT_BUDGET_CLIENT_ID} campaignId={null} variant="campaign-form" />
    </QueryClientProvider>);
    expect(html).toContain('data-layout="compact-auto-row"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="true"[^>]*>/);
    expect(html.match(/<button[^>]*role="switch"[^>]*>/)?.[0]).not.toContain(' disabled=""');
    expect(html).not.toContain("ใช้ถึง 80%");
    expect(html).not.toContain("ยืนยันเปิด Auto ต่อเนื่อง ใช้เงินจริง");
    expect(post).not.toHaveBeenCalled();
    queryClient.clear();
  });

  it("shows the scoped Auto switch and never treats an available preview as an armed session", () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const post = vi.spyOn(http, "post");
    const props = { variant: "campaign-form", campaignId: sampleNumericCampaign, clientId: PILOT_BUDGET_CLIENT_ID, dataUpdatedAt: now, refresh: async () => null } as const;
    const tag = (html: string) => html.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? "";
    const available = renderToStaticMarkup(<AutoBudgetControls {...props} data={spendTrend} />);
    expect(tag(available)).toContain('aria-checked="false"');
    expect(tag(available)).not.toContain(' disabled=""');
    expect(available).not.toContain("ยืนยันเปิด Auto ต่อเนื่อง ใช้เงินจริง");
    const blocked = renderToStaticMarkup(<AutoBudgetControls {...props} data={spendTrend} blockAutoStart />);
    expect(tag(blocked)).toContain(' disabled=""');
    const activeSummary = { ...spendTrend, canArm: false, canStop: true, preview: null, overviewState: "on",
      continuousSession: { sessionId, status: "ARMED", startedAt: observedAt },
    } satisfies BudgetAutoStatus;
    const enabled = renderToStaticMarkup(<AutoBudgetControls {...props} campaignId={null} data={activeSummary} blockAutoStart />);
    expect(tag(enabled)).toContain('aria-checked="true"');
    expect(tag(enabled)).not.toContain(' disabled=""');
    expect(autoFormSwitchState(activeSummary, SRIHIW_CAP_CLIENT_ID)).toBeNull();
    expect(autoFormSwitchState({ ...activeSummary, continuousSession: null, overviewState: null }, PILOT_BUDGET_CLIENT_ID)).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("accepts exact Ppan status and preserves nnshop5719's one-shot payload", () => {
    const session = { sessionId, status: "ARMED", startedAt: observedAt, reason: null } as const;
    expect(budgetAutoStatusSchema.safeParse({ ...continuous, continuousSession: session }).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...continuous, clientId: NNSHOP_CAP_CLIENT_ID }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...status, continuousSession: session }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...continuous, continuousSession: { ...session, sessionId: "invalid" } }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...continuous, preview: { ...continuous.preview, liveSessionId: "invalid" } }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...status, clientId: NNSHOP_CAP_CLIENT_ID }).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...status, clientId: NNSHOP_CAP_CLIENT_ID, strategy: "one-shot", mode: "disabled", preview: null }).success).toBe(true);
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
    await expect(stopBudgetAutoContinuous("unknown-creator" as BudgetCapClientId, sessionId)).rejects.toThrow();
    expect(post.mock.calls).toEqual([["/automation/budget/srihiw/auto/arm", input], ["/automation/budget/srihiw/auto/stop", { sessionId }]]);
  });

  it.each([ASHOP_CAP_CLIENT_ID, MYUSHOP_CAP_CLIENT_ID, BUBPA_CAP_CLIENT_ID, NNSHOP_CAP_CLIENT_ID] as const)("uses immediate verified-room spend-trend Auto on the exact %s route", async (clientId) => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const ready = { ...continuous, clientId, evidenceMode: VERIFIED_ROOM_SPEND_TREND } satisfies BudgetAutoStatus;
    const armed = { ...ready, canArm: false, canStop: true,
      continuousSession: { sessionId, startedAt: observedAt, status: "ARMED" } } satisfies BudgetAutoStatus;
    const get = vi.spyOn(http, "get").mockResolvedValueOnce({ data: ready }).mockResolvedValueOnce({ data: continuous });
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { sessionId, startedAt: observedAt } })
      .mockResolvedValueOnce({ data: { stopped: true } });
    const path = `/automation/budget/${clientId}/auto`;
    await expect(fetchBudgetAutoStatus(clientId)).resolves.toEqual(ready);
    await expect(fetchBudgetAutoStatus(clientId)).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    expect(get.mock.calls.map(([requestPath]) => requestPath)).toEqual([`${path}/status`, `${path}/status`]);
    expect(budgetAutoStatusSchema.safeParse(ready).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse(armed).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...ready, evidenceMode: undefined }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...ready, evidenceMode: "verified-room" }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...spendTrend, clientId }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...ready, strategy: "one-shot" }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...ready, grant: { grantId, status: "ARMED", expiresAt } }).success).toBe(false);
    expect(getAutoArmPreview(ready, sampleNumericCampaign, now)).toEqual(ready.preview);
    expect(getAutoArmPreview({ ...ready, evidenceMode: undefined }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, preview: { ...ready.preview, liveSessionId: null } }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, strategy: "one-shot" }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...spendTrend, clientId }, sampleNumericCampaign, now)).toBeNull();
    const props = { clientId, dataUpdatedAt: now, refresh: async () => null } as const;
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={ready} campaignId={sampleNumericCampaign} />)).toContain("ตรวจเงื่อนไขก่อนเปิด Auto ต่อเนื่อง");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={armed} campaignId={null} />)).toContain("หยุด Auto ต่อเนื่อง");
    const html = renderToStaticMarkup(<AutoBudgetStatusBody data={ready} campaignId={sampleNumericCampaign} now={now} />);
    expect(html).toContain("เป็นห้อง LIVE เดิม");
    expect(html).toContain("ยอดใช้จาก TikTok เพิ่มขึ้นระหว่างการอ่านสองรอบ");
    expect(html).toContain("ไม่ใช่เวลาที่ TikTok อัปเดตยอดใช้");
    expect(html).not.toContain("สัญญาณแทนการยืนยัน LIVE");
    const exact = { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 800_000, expectedPolicyRevision: 2 };
    const attestations = { nativeAutoOff: true, noConcurrentChanges: true } as const;
    const verifiedRoom = { ...exact, ...attestations, expectedLiveSessionId: sampleLiveSessionId };
    const input = { ...verifiedRoom, evidenceMode: VERIFIED_ROOM_SPEND_TREND } as const;
    await expect(armBudgetAutoContinuous(clientId, { ...exact, evidenceMode: "spend-trend" })).rejects.toThrow();
    await expect(armBudgetAutoContinuous(clientId, verifiedRoom)).rejects.toThrow();
    if (clientId !== NNSHOP_CAP_CLIENT_ID) await expect(armBudgetAuto(clientId, { ...exact, ...attestations, durationMinutes: 30 })).rejects.toThrow();
    await expect(armBudgetAutoContinuous(clientId, input)).resolves.toEqual({ sessionId, startedAt: observedAt });
    await expect(stopBudgetAutoContinuous(clientId, sessionId)).resolves.toEqual({ stopped: true });
    expect(post.mock.calls).toEqual([[`${path}/arm`, input], [`${path}/stop`, { sessionId }]]);
  });

  it.each([PILOT_BUDGET_CLIENT_ID, SRIHIW_CAP_CLIENT_ID] as const)("accepts explicit immediate hybrid status for %s without replacing the legacy flow", async (clientId) => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const ready = { ...continuous, clientId, evidenceMode: VERIFIED_ROOM_SPEND_TREND } satisfies BudgetAutoStatus;
    expect(budgetAutoStatusSchema.safeParse(ready).success).toBe(true);
    expect(getAutoArmPreview(ready, sampleNumericCampaign, now)).toEqual(ready.preview);
    const armed = { ...ready, canArm: false, canStop: true, preview: null,
      continuousSession: { sessionId, startedAt: observedAt, status: "ARMED", waitingForLive: false } } satisfies BudgetAutoStatus;
    expect(budgetAutoStatusSchema.safeParse(armed).success).toBe(true);
    expect(renderToStaticMarkup(<AutoBudgetControls clientId={clientId} data={armed} campaignId={null} dataUpdatedAt={now}
      refresh={async () => null} />)).toContain("หยุด Auto ต่อเนื่อง");
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { sessionId, startedAt: observedAt } })
      .mockResolvedValueOnce({ data: { stopped: true } });
    const input = { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 800_000, expectedPolicyRevision: 2,
      expectedLiveSessionId: sampleLiveSessionId, nativeAutoOff: true, noConcurrentChanges: true, evidenceMode: VERIFIED_ROOM_SPEND_TREND } as const;
    await expect(armBudgetAutoContinuous(clientId, input)).resolves.toEqual({ sessionId, startedAt: observedAt });
    await expect(stopBudgetAutoContinuous(clientId, sessionId)).resolves.toEqual({ stopped: true });
    const scope = clientId === PILOT_BUDGET_CLIENT_ID ? "/automation/budget" : `/automation/budget/${clientId}`;
    expect(post.mock.calls).toEqual([[`${scope}/auto/arm`, input], [`${scope}/auto/stop`, { sessionId }]]);
  });

  it.each([PILOT_BUDGET_CLIENT_ID, SRIHIW_CAP_CLIENT_ID, NNSHOP_CAP_CLIENT_ID, ASHOP_CAP_CLIENT_ID, MYUSHOP_CAP_CLIENT_ID, BUBPA_CAP_CLIENT_ID] as const)("pre-arms only an explicitly eligible exact campaign while %s waits for LIVE", async (clientId) => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const evidenceMode = clientId === PILOT_BUDGET_CLIENT_ID || clientId === SRIHIW_CAP_CLIENT_ID ? "spend-trend" : VERIFIED_ROOM_SPEND_TREND;
    const ready = { ...continuous, clientId, evidenceMode,
      preview: { ...continuous.preview, liveSessionId: null, waitingForLive: true, status: "WAITING_FOR_LIVE", spendMinor: null } } satisfies BudgetAutoStatus;
    const waiting = { ...ready, evidenceMode: VERIFIED_ROOM_SPEND_TREND, overviewState: "on", canArm: false, canStop: true, preview: null,
      continuousSession: { sessionId, startedAt: observedAt, status: "ARMED", waitingForLive: true } } satisfies BudgetAutoStatus;
    expect(budgetAutoStatusSchema.safeParse(ready).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse(waiting).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...waiting, continuousSession: { ...waiting.continuousSession, waitingForLive: false } }).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...waiting, evidenceMode: "spend-trend" }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...ready, preview: { ...ready.preview, liveSessionId: sampleLiveSessionId } }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...ready, preview: { ...ready.preview, spendMinor: 0 } }).success).toBe(false);
    expect(budgetAutoStatusSchema.safeParse({ ...ready, preview: { ...ready.preview, status: "BELOW_THRESHOLD" } }).success).toBe(false);
    expect(getAutoArmPreview(ready, sampleNumericCampaign, now)).toEqual(ready.preview);
    expect(getAutoArmPreview(ready, null, now)).toBeNull();
    expect(getAutoArmPreview(ready, "2234567890123456", now)).toBeNull();
    expect(getAutoArmPreview(ready, sampleNumericCampaign, now + 46_000)).toBeNull();
    expect(getAutoArmPreview({ ...ready, blockers: ["LINE_NOT_READY"] }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, clientId: "unknown-creator" as BudgetCapClientId }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, preview: { ...ready.preview, spendMinor: 0 } }, sampleNumericCampaign, now)).toBeNull();
    expect(getAutoArmPreview({ ...ready, preview: { ...ready.preview, waitingForLive: undefined } }, sampleNumericCampaign, now)).toBeNull();
    const props = { clientId, dataUpdatedAt: now, refresh: async () => null } as const;
    const review = renderToStaticMarkup(<AutoBudgetControls {...props} data={ready} campaignId={sampleNumericCampaign} />);
    expect(review).toContain("ตรวจเงื่อนไขก่อนเปิด Auto ต่อเนื่อง");
    const details = renderToStaticMarkup(<AutoBudgetStatusBody data={ready} campaignId={sampleNumericCampaign} now={now} />);
    expect(details).toContain("เปิดรอได้โดยยังไม่เพิ่มงบ");
    expect(details).not.toContain("สัญญาณแทนการยืนยัน LIVE");
    const armed = renderToStaticMarkup(<AutoBudgetControls {...props} data={waiting} campaignId={null} variant="campaign-form" />);
    expect(armed).toContain("เปิดแล้ว · รอ LIVE");
    expect(armed).toContain('aria-checked="true"');
    expect(armed).not.toContain("ยังไม่ยืนยันแคมเปญ");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={waiting} campaignId={null} />)).toContain("หยุด Auto ต่อเนื่อง");
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { sessionId, startedAt: observedAt } })
      .mockResolvedValueOnce({ data: { stopped: true } });
    const input = { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 800_000, expectedPolicyRevision: 2,
      expectedLiveSessionId: null, nativeAutoOff: true, noConcurrentChanges: true, evidenceMode: VERIFIED_ROOM_SPEND_TREND } as const;
    await expect(armBudgetAutoContinuous("unknown-creator" as BudgetCapClientId, input)).rejects.toThrow();
    await expect(armBudgetAutoContinuous(clientId, { ...input, noConcurrentChanges: false } as unknown as typeof input)).rejects.toThrow();
    await expect(armBudgetAutoContinuous(clientId, input)).resolves.toEqual({ sessionId, startedAt: observedAt });
    await expect(stopBudgetAutoContinuous(clientId, sessionId)).resolves.toEqual({ stopped: true });
    const scope = clientId === PILOT_BUDGET_CLIENT_ID ? "/automation/budget" : `/automation/budget/${clientId}`;
    expect(post.mock.calls).toEqual([[`${scope}/auto/arm`, input], [`${scope}/auto/stop`, { sessionId }]]);
  });

  it("keeps old wait-next authority separate from a new opt-in to check for a verified LIVE each minute", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const clientId = BUBPA_CAP_CLIENT_ID;
    const old = { ...continuous, clientId, evidenceMode: VERIFIED_ROOM_SPEND_TREND,
      preview: { ...continuous.preview, status: WAITING_FOR_LIVE, waitingForLive: true, spendMinor: null, liveSessionId: null } } satisfies BudgetAutoStatus;
    const next = { ...old, preview: { ...old.preview, autoDetectLive: true } } satisfies BudgetAutoStatus;
    expect(budgetAutoStatusSchema.safeParse(old).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse(next).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...next, preview: { ...next.preview, spendMinor: 800 } }).success).toBe(true);
    expect(budgetAutoStatusSchema.safeParse({ ...next, clientId: PILOT_BUDGET_CLIENT_ID, evidenceMode: "spend-trend" }).success).toBe(true);
    expect(getAutoArmPreview(next, sampleNumericCampaign, now)).toEqual(next.preview);
    const common = { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 800_000, expectedPolicyRevision: 2,
      expectedLiveSessionId: null, evidenceMode: VERIFIED_ROOM_SPEND_TREND } as const;
    expect(buildAutoArmDraft(old, old.preview, 30)?.input).toEqual(common);
    expect(buildAutoArmDraft(next, next.preview, 30)?.input).toEqual({ ...common, autoDetectLive: true });
    const waiting = { ...old, canArm: false, canStop: true, preview: null,
      continuousSession: { sessionId, startedAt: observedAt, status: "ARMED", waitingForLive: true } } satisfies BudgetAutoStatus;
    const detecting = { ...waiting, continuousSession: { ...waiting.continuousSession, autoDetectLive: true } } satisfies BudgetAutoStatus;
    expect(budgetAutoStatusSchema.safeParse({ ...detecting, clientId: PILOT_BUDGET_CLIENT_ID, evidenceMode: "spend-trend",
      continuousSession: { ...detecting.continuousSession, status: "STOPPED", waitingForLive: false } }).success).toBe(true);
    const props = { clientId, campaignId: null, dataUpdatedAt: now, refresh: async () => null } as const;
    expect(getAutoArmPreview(waiting, sampleNumericCampaign, now)).toBeNull();
    const legacyHtml = renderToStaticMarkup(<AutoBudgetStatusBody data={waiting} campaignId={null} now={now} />);
    expect(legacyHtml).toContain("รอบเดิมรอ LIVE ใหม่เท่านั้น");
    expect(legacyHtml).toContain("หยุด Auto แล้วเปิดใหม่");
    expect(legacyHtml).not.toContain("กำลังตรวจหาห้อง LIVE");
    expect(renderToStaticMarkup(<AutoBudgetStatusBody data={{ ...waiting, preview: next.preview }}
      campaignId={sampleNumericCampaign} now={now} />)).not.toContain("ตรวจทุก 1 นาที");
    expect(renderToStaticMarkup(<AutoBudgetControls {...props} data={detecting} variant="campaign-form" />)).toContain("เปิดแล้ว · กำลังตรวจหาห้อง LIVE");
    const newHtml = renderToStaticMarkup(<AutoBudgetStatusBody data={next} campaignId={sampleNumericCampaign} now={now} />);
    expect(newHtml).toContain("ตรวจทุก 1 นาที");
    expect(newHtml).toContain("ไม่ย้ายไปห้องถัดไป");
    const post = vi.spyOn(http, "post").mockResolvedValue({ data: { sessionId, startedAt: observedAt } });
    const oldInput = { ...common, nativeAutoOff: true, noConcurrentChanges: true } as const;
    const newInput = { ...oldInput, autoDetectLive: true } as const;
    await expect(armBudgetAutoContinuous(clientId, oldInput)).resolves.toEqual({ sessionId, startedAt: observedAt });
    await expect(armBudgetAutoContinuous(clientId, newInput)).resolves.toEqual({ sessionId, startedAt: observedAt });
    expect(post.mock.calls).toEqual([[`/automation/budget/${clientId}/auto/arm`, oldInput], [`/automation/budget/${clientId}/auto/arm`, newInput]]);
  });

  it("can authorize the exact current LIVE with no spend while displaying only its verified Bangkok start", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const clientId = ASHOP_CAP_CLIENT_ID, liveSessionStartedAt = "2026-03-06T00:17:00.000Z";
    const ready = { ...continuous, clientId, evidenceMode: VERIFIED_ROOM_SPEND_TREND,
      preview: { ...continuous.preview, status: LIVE_WAITING_FOR_SPEND, autoDetectLive: true, spendMinor: null,
        targetBudgetMinor: null, projectedClientSpendMinor: null, liveSessionStartedAt } } satisfies BudgetAutoStatus;
    expect(budgetAutoStatusSchema.safeParse(ready).success).toBe(true);
    for (const invalid of [{ liveSessionStartedAt: undefined }, { liveSessionStartedAt: "2026-03-06 07:17:00" },
      { liveSessionId: null }, { autoDetectLive: undefined }, { waitingForLive: true }, { spendMinor: 0 }]) {
      expect(budgetAutoStatusSchema.safeParse({ ...ready, preview: { ...ready.preview, ...invalid } }).success).toBe(false);
    }
    expect(getAutoArmPreview(ready, sampleNumericCampaign, now)).toEqual(ready.preview);
    expect(getAutoArmPreview({ ...ready, blockers: ["LINE_NOT_READY"] }, sampleNumericCampaign, now)).toBeNull();
    const input = { expectedCampaignId: sampleNumericCampaign, expectedBudgetMinor: 800_000, expectedPolicyRevision: 2,
      expectedLiveSessionId: sampleLiveSessionId, evidenceMode: VERIFIED_ROOM_SPEND_TREND, autoDetectLive: true } as const;
    expect(buildAutoArmDraft(ready, ready.preview, 30)).toMatchObject({ input, liveSessionStartedAt });
    const statusHtml = renderToStaticMarkup(<AutoBudgetStatusBody data={ready} campaignId={sampleNumericCampaign} now={now} />);
    expect(statusHtml).toContain("เริ่ม LIVE จริง");
    expect(statusHtml).toContain("07:17");
    expect(statusHtml).not.toContain("00:17");
    const bound = { ...ready, canArm: false, canStop: true,
      continuousSession: { sessionId, startedAt: observedAt, status: "ARMED", autoDetectLive: true } } satisfies BudgetAutoStatus;
    expect(budgetAutoStatusSchema.safeParse(bound).success).toBe(true);
    expect(renderToStaticMarkup(<AutoBudgetControls clientId={clientId} campaignId={sampleNumericCampaign} data={bound}
      dataUpdatedAt={now} refresh={async () => null} variant="campaign-form" />)).toContain("ผูกห้อง LIVE แล้ว · รอยอดใช้");
    const post = vi.spyOn(http, "post").mockResolvedValueOnce({ data: { sessionId, startedAt: observedAt } })
      .mockResolvedValueOnce({ data: { stopped: true } });
    const request = { ...input, nativeAutoOff: true, noConcurrentChanges: true } as const;
    await expect(armBudgetAutoContinuous(clientId, request)).resolves.toEqual({ sessionId, startedAt: observedAt });
    await expect(stopBudgetAutoContinuous(clientId, sessionId)).resolves.toEqual({ stopped: true });
    expect(post.mock.calls).toEqual([[`/automation/budget/${clientId}/auto/arm`, request], [`/automation/budget/${clientId}/auto/stop`, { sessionId }]]);
  });
});
