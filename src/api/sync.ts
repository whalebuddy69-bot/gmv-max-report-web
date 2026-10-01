import { z } from "zod";
import { http, request } from "./client";

const syncStatusSchema = z.object({
  enabled: z.boolean(),
  cron: z.string(),
  /** True while the whole-account sweep is running. */
  running: z.boolean(),
  /** Stores with a manual sync in flight, as "advertiserId:storeId". */
  runningTargets: z.array(z.string()).optional().transform((v) => v ?? []),
});

export interface SyncStatus {
  enabled: boolean;
  cron: string;
  running: boolean;
  runningTargets: string[];
}

export function fetchSyncStatus(): Promise<SyncStatus> {
  return request(syncStatusSchema, "/sync/status", () => http.get("/sync/status"));
}

const startSyncSchema = z.object({ started: z.boolean() });

/** Kicks off one store and returns immediately */
export async function startStoreSync(advertiserId: string, storeId: string): Promise<boolean> {
  try {
    await request(startSyncSchema, "/sync/run", () =>
      http.post("/sync/run", { advertiserId, storeId }),
    );
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "SYNC_RUNNING") return false;
    throw err;
  }
}

/** Matches the key the service reports in `runningTargets`. */
export function targetKey(advertiserId: string, storeId: string): string {
  return `${advertiserId}:${storeId}`;
}
