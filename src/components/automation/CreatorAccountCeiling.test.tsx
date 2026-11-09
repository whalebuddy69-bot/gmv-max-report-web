import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { PILOT_BUDGET_CLIENT_ID } from "@/api/automation";
import { SRIHIW_CAP_CLIENT_ID } from "@/api/automationBudget";
import { http } from "@/api/client";
import { CreatorAccountCeiling } from "./CreatorAccountCeiling";

afterEach(() => vi.restoreAllMocks());

it("shows scoped Daily Ceiling without a campaign, and never mounts edit controls while collapsed", () => {
  const readAt = "2026-11-09T08:30:00.000Z";
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(readAt));
  const post = vi.spyOn(http, "post");
  const cap = (clientId: string, minor: number) => ({ clientId, capEditAllowed: true, cap: {
    revision: 1, campaignCapMinor: minor, clientDailyCapMinor: minor, readAt, locked: false,
  } });
  const queries = new QueryClient();
  queries.setQueryData(["automation", "budget-status", 3, PILOT_BUDGET_CLIENT_ID], cap(PILOT_BUDGET_CLIENT_ID, 900_000));
  queries.setQueryData(["automation", "cap-status", 3, SRIHIW_CAP_CLIENT_ID], cap(SRIHIW_CAP_CLIENT_ID, 500_000));
  const render = (id: typeof PILOT_BUDGET_CLIENT_ID | typeof SRIHIW_CAP_CLIENT_ID) => renderToStaticMarkup(<QueryClientProvider client={queries}>
    <CreatorAccountCeiling clientId={id} userId={3} displayName="Fixture" />
  </QueryClientProvider>);
  const extra = render(SRIHIW_CAP_CLIENT_ID);
  expect(extra).toContain('data-layout="compact-ceiling-row"');
  expect(extra).toContain("bg-amber-50");
  expect(extra).toContain("min-h-8");
  expect(extra).toContain("฿5,000.00");
  expect(extra).not.toContain("฿9,000.00");
  expect(extra).not.toContain("แก้เพดานงบ");
  expect(render(PILOT_BUDGET_CLIENT_ID)).toContain("฿9,000.00");
  expect(post).not.toHaveBeenCalled();
  queries.clear();
});
