import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PILOT_BUDGET_CLIENT_ID } from "@/api/automation";
import { fetchAdditionalBudgetCapStatus, fetchBudgetStatus, type BudgetCapClientId, type BudgetCapStatus } from "@/api/automationBudget";
import { ApiError } from "@/api/client";
import { BudgetCapEditor } from "./BudgetCapEditor";

/** This is a Creator-level control, independent of a selected campaign or campaign sync. */
export function CreatorAccountCeiling({ clientId, userId, displayName }: {
  clientId: BudgetCapClientId;
  userId: number;
  displayName: string;
}) {
  const queryClient = useQueryClient();
  const pilot = clientId === PILOT_BUDGET_CLIENT_ID;
  const query = useQuery<BudgetCapStatus>({
    queryKey: ["automation", pilot ? "budget-status" : "cap-status", userId, clientId],
    queryFn: ({ signal }) => clientId === PILOT_BUDGET_CLIENT_ID
      ? fetchBudgetStatus(signal, clientId)
      : fetchAdditionalBudgetCapStatus(clientId, signal),
    retry: false,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    refetchInterval: ({ state }) => state.error instanceof ApiError && [401, 403, 404].includes(state.error.status ?? 0) ? false : 25_000,
  });
  return <BudgetCapEditor key={`${userId}:${clientId}`} active clientId={clientId} displayName={displayName}
    status={query.isSuccess ? query.data : null} loading={query.isPending} variant="campaign-form"
    refreshStatus={() => Promise.all([
      query.refetch(),
      !pilot && queryClient.invalidateQueries({ queryKey: ["automation", "budget-status", userId, clientId], exact: true }),
    ])} />;
}
