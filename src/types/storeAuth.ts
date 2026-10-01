/** Mirrors the service's storeAuthorization.service.ts. */

export type StoreAuthorizationStatus =
  | "ok"
  | "noData"
  | "syncError"
  | "syncDisabled"
  | "notDiscovered"
  | "notAuthorized"
  | "gmvMaxUnavailable";

export interface StoreAuthorizationRow {
  storeId: string;
  storeName: string;
  storeCode: string | null;
  /** The advertiser whose token this store was seen through. */
  advertiserId: string;
  status: StoreAuthorizationStatus;
  /** Thai explanation of `status`, written by the service. */
  reason: string;
  /** What to do next; null when nothing is needed. */
  action: string | null;

  isGmvMaxAvailable: boolean;
  storeStatus: string | null;
  /** The ad account that actually holds GMV Max rights for this shop. */
  exclusiveAdvertiserId: string | null;
  exclusiveAdvertiserName: string | null;
  storeAuthorizedBcId: string | null;
  bcName: string | null;

  /** From sync_targets; null when there is no row for this (advertiser, store). */
  syncEnabled: boolean | null;
  /** ISO 8601. */
  lastSyncedAt: string | null;
  lastError: string | null;

  /** Coverage in report_campaign_daily, as YYYY-MM-DD. */
  firstDate: string | null;
  lastDate: string | null;
  rowCount: number;
}

export interface StoreAuthorizationResult {
  stores: StoreAuthorizationRow[];
  /** Advertisers whose store list could not be fetched, usually an expired token. */
  advertiserErrors: { advertiserId: string; message: string }[];
  advertisersChecked: number;
  checkedAt: string;
  cached: boolean;
}

/** POST /analytics/store-authorization/authorize-link */
export interface AuthorizeLink {
  url: string;
  /** ISO 8601. */
  expiresAt: string;
}

/** What the service reports on `/stores?authz=…` after the consent round trip */
export type AuthorizeOutcomeStatus = "ok" | "mismatch" | "error";

export interface AuthorizeOutcome {
  status: AuthorizeOutcomeStatus;
  /** The advertiser the link was created for; absent when the state was unreadable. */
  advertiserId: string | null;
  /** How many advertiser accounts the consent actually granted. */
  granted: number;
  detail: string | null;
}
