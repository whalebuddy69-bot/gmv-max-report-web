import axios, { AxiosError, type AxiosInstance } from "axios";
import { z } from "zod";
import { apiErrorSchema } from "./schemas";

/** An error we can render. `code` mirrors the service's error envelope. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly details: unknown;

  constructor(message: string, options: { code: string; status?: number | null; details?: unknown }) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.details = options.details;
  }

  /** True when the session is gone: expired token, deactivated account, password reset. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.code === "AUTH_FAILED";
  }
}

const baseURL = import.meta.env.VITE_API_BASE_URL || "/api";

export const http: AxiosInstance = axios.create({
  baseURL,
  timeout: 60_000,
  headers: { "Content-Type": "application/json" },
});

/*
 * The token is held in a module variable rather than read from the store inside the
 * interceptor, so api/ has no import back into store/
 */
let authToken: string | null = null;
let onAuthFailure: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Registered once by authStore so an expired token logs the user out everywhere. */
export function setAuthFailureHandler(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

http.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    // A 401 on any call means the session is over
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const url = error.config?.url ?? "";
      if (!url.includes("/auth/login")) onAuthFailure?.();
    }
    return Promise.reject(error);
  },
);

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;

  if (axios.isAxiosError(err)) {
    const axiosErr = err as AxiosError<unknown>;

    if (axiosErr.code === "ECONNABORTED") {
      return new ApiError("คำขอใช้เวลานานเกินไป ลองแคบช่วงวันที่ลง", {
        code: "TIMEOUT",
        status: null,
      });
    }

    const parsed = apiErrorSchema.safeParse(axiosErr.response?.data);
    if (parsed.success) {
      return new ApiError(parsed.data.error.message, {
        code: parsed.data.error.code,
        status: axiosErr.response?.status ?? null,
        details: parsed.data.error.details,
      });
    }

    const status = axiosErr.response?.status ?? null;

    // No response at all, or a gateway status from whatever sits in front of the service
    if (status === null || status === 502 || status === 503 || status === 504) {
      return new ApiError("ติดต่อ gmv-max-report ไม่ได้ ตรวจว่า service ทำงานอยู่", {
        code: "SERVICE_UNREACHABLE",
        status,
      });
    }

    return new ApiError(`คำขอล้มเหลว (HTTP ${status})`, { code: "HTTP_ERROR", status });
  }

  return new ApiError(err instanceof Error ? err.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก", {
    code: "UNKNOWN",
  });
}

/** Validates a payload, turning a Zod failure into an ApiError we can display. */
export function parseResponse<T>(
  // input is unknown because the schemas coerce (string -> number, missing -> null)
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  payload: unknown,
  context: string,
): T {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  const firstIssue = result.error.issues[0];
  const where = firstIssue?.path.join(".") ?? "(root)";
  throw new ApiError(`ข้อมูลจาก ${context} ผิดรูปแบบที่ ${where}: ${firstIssue?.message ?? ""}`, {
    code: "SCHEMA_MISMATCH",
    details: result.error.issues,
  });
}

/** Wraps a request so every caller reports failures the same way. */
export async function request<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  context: string,
  send: () => Promise<{ data: unknown }>,
): Promise<T> {
  try {
    const response = await send();
    return parseResponse(schema, response.data, context);
  } catch (err) {
    throw toApiError(err);
  }
}
