import { z } from "zod";

const numericField = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((raw, ctx): number | null => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `ค่าตัวเลขไม่ถูกต้อง: ${raw}` });
      return z.NEVER;
    }
    return parsed;
  });

const textField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v): string | null => (v === undefined || v === "" ? null : v));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ต้องเป็นรูปแบบ YYYY-MM-DD");
const nullableIsoDate = z
  .union([isoDate, z.null(), z.undefined()])
  .transform((v): string | null => v ?? null);

const timestampField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v): string | null => v ?? null);

export const shopContentTypeSchema = z
  .union([z.enum(["VIDEO", "PRODUCT_CARD"]), z.null(), z.undefined()])
  .transform((v) => v ?? null);

/* ------------------------------------------------------------------- auth */

export const sessionUserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: textField,
  role: z.enum(["viewer", "admin"]),
});

export const loginResultSchema = z.object({
  token: z.string().min(1),
  expiresIn: z.number().int().positive(),
  user: sessionUserSchema,
});

export const publicUserSchema = sessionUserSchema.extend({
  isActive: z.boolean(),
  lastLoginAt: timestampField,
  createdAt: z.string(),
});

export const changePasswordResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  reloginRequired: z.boolean().optional().transform((v) => v ?? true),
});

/* -------------------------------------------------------------- analytics */

export const storesResponseSchema = z.object({
  stores: z.array(
    z.object({
      store_id: z.string(),
      store_name: textField,
      advertiser_id: z.string(),
      enabled: z.boolean(),
      last_synced_at: timestampField,
      first_date: nullableIsoDate,
      last_date: nullableIsoDate,
    }),
  ),
});

export const campaignOptionsResponseSchema = z.object({
  campaigns: z.array(
    z.object({
      campaign_id: z.string(),
      campaign_name: textField,
      cost: numericField,
    }),
  ),
});

const summaryTotalsSchema = z.object({
  cost: numericField,
  net_cost: numericField,
  orders: numericField,
  gross_revenue: numericField,
  roi: numericField,
  cost_per_order: numericField,
  campaigns: numericField,
  total_videos: numericField,
  videos_with_sales: numericField,
  creators_with_sales: numericField,
});

export const summaryResponseSchema = z.object({
  range: z.object({ from: isoDate, to: isoDate, days: z.number().int() }),
  previousRange: z.object({ from: isoDate, to: isoDate }),
  current: summaryTotalsSchema,
  previous: summaryTotalsSchema,
});

export const timeseriesResponseSchema = z.object({
  points: z.array(
    z.object({
      stat_date: isoDate,
      cost: numericField,
      orders: numericField,
      gross_revenue: numericField,
      roi: numericField,
    }),
  ),
});

/** `/analytics/all`, one row per day, the daily form of the summary cards. */
export const allDaysResponseSchema = z.object({
  days: z.array(
    z.object({
      stat_date: isoDate,
      cost: numericField,
      orders: numericField,
      gross_revenue: numericField,
      roi: numericField,
      total_videos: numericField,
      videos_with_sales: numericField,
      creators_with_sales: numericField,
    }),
  ),
});

export const campaignsResponseSchema = z.object({
  campaigns: z.array(
    z.object({
      store_id: z.string(),
      campaign_id: z.string(),
      campaign_name: textField,
      // falls back to PRODUCT when the column is missing
      promotion_type: z.enum(["PRODUCT", "LIVE"]).catch("PRODUCT"),
      identity_id: textField,
      tt_account_name: textField,
      tt_account_profile_image_url: textField,
      operation_status: textField,
      roas_bid: numericField,
      cost: numericField,
      net_cost: numericField,
      orders: numericField,
      gross_revenue: numericField,
      roi: numericField,
      cost_per_order: numericField,
    }),
  ),
});

/** `/analytics/creator-options`, Live campaign creators, ranked by spend. */
export const creatorOptionsResponseSchema = z.object({
  creators: z.array(
    z.object({
      identity_id: z.string(),
      tt_account_name: textField,
      cost: numericField,
    }),
  ),
});

/** `/analytics/live-rooms` */
export const liveRoomsResponseSchema = z.object({
  liveRooms: z.array(
    z.object({
      store_id: z.string(),
      campaign_id: z.string(),
      room_id: z.string(),
      live_name: textField,
      live_status: textField,
      // Text, not a date
      live_launched_time: textField,
      live_duration: textField,
      start_date: textField,
      start_time: textField,
      end_time: textField,
      duration_seconds: numericField,
      cost: numericField,
      net_cost: numericField,
      orders: numericField,
      gross_revenue: numericField,
      roi: numericField,
      cost_per_order: numericField,
      live_views: numericField,
      live_views_10s: numericField,
      cost_per_live_view: numericField,
      cost_per_live_view_10s: numericField,
      live_follows: numericField,
    }),
  ),
});

export const productsResponseSchema = z.object({
  products: z.array(
    z.object({
      store_id: z.string(),
      item_group_id: z.string(),
      product_name: textField,
      product_status: textField,
      campaigns: numericField,
      cost: numericField,
      orders: numericField,
      gross_revenue: numericField,
      roi: numericField,
      cost_per_order: numericField,
    }),
  ),
});

export const creatorsResponseSchema = z.object({
  creators: z.array(
    z.object({
      tt_account_name: z.string(),
      authorization_type: textField,
      creatives: numericField,
      campaigns: numericField,
      cost: numericField,
      orders: numericField,
      gross_revenue: numericField,
      roi: numericField,
      cost_per_order: numericField,
      product_impressions: numericField,
      product_clicks: numericField,
      product_click_rate: numericField,
    }),
  ),
});

export const creativesResponseSchema = z.object({
  creatives: z.array(
    z.object({
      store_id: z.string(),
      campaign_id: z.string(),
      item_group_id: z.string(),
      item_id: z.string(),
      campaign_name: textField,
      title: textField,
      tt_account_name: textField,
      tt_account_username: textField,
      authorization_type: textField,
      shop_content_type: shopContentTypeSchema,
      creative_delivery_status: textField,
      cost: numericField,
      orders: numericField,
      gross_revenue: numericField,
      roi: numericField,
      product_impressions: numericField,
      product_clicks: numericField,
      product_click_rate: numericField,
    }),
  ),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
});

/* -------------------------------------------------- store authorization */

/**
 * This endpoint composes its response in TypeScript rather than aliasing SQL, so it is
 * camelCase already and needs no renaming on the way in
 */
export const storeAuthorizationResponseSchema = z.object({
  stores: z.array(
    z.object({
      storeId: z.string(),
      storeName: z.string(),
      storeCode: textField,
      advertiserId: z.string(),
      status: z.enum([
        "ok",
        "noData",
        "syncError",
        "syncDisabled",
        "notDiscovered",
        "notAuthorized",
        "gmvMaxUnavailable",
      ]),
      reason: z.string(),
      action: textField,
      isGmvMaxAvailable: z.boolean(),
      storeStatus: textField,
      exclusiveAdvertiserId: textField,
      exclusiveAdvertiserName: textField,
      storeAuthorizedBcId: textField,
      bcName: textField,
      syncEnabled: z.union([z.boolean(), z.null(), z.undefined()]).transform((v) => v ?? null),
      lastSyncedAt: timestampField,
      lastError: textField,
      firstDate: nullableIsoDate,
      lastDate: nullableIsoDate,
      rowCount: z.number().int().min(0),
    }),
  ),
  advertiserErrors: z.array(z.object({ advertiserId: z.string(), message: z.string() })),
  advertisersChecked: z.number().int().min(0),
  checkedAt: z.string(),
  cached: z.boolean(),
});

/** POST /analytics/store-authorization/authorize-link */
export const authorizeLinkResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
});

/** The service's error envelope from src/index.ts. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
