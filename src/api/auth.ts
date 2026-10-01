import type { ChangePasswordResult, LoginResult, PublicUser } from "@/types/auth";
import { http, request } from "./client";
import { changePasswordResultSchema, loginResultSchema, publicUserSchema } from "./schemas";

/** `/auth/*`. The only routes reachable without a token are login and health. */

export function login(email: string, password: string): Promise<LoginResult> {
  return request(loginResultSchema, "/auth/login", () =>
    http.post("/auth/login", { email, password }),
  );
}

/** Restores a session on reload, and re-checks that the account is still active. */
export function fetchMe(): Promise<PublicUser> {
  return request(publicUserSchema, "/auth/me", () => http.get("/auth/me"));
}

/**
 * Succeeding invalidates every token for this user, including the one that made the request, so
 * the caller must send the user back to the login screen afterwards
 */
export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  return request(changePasswordResultSchema, "/auth/change-password", () =>
    http.post("/auth/change-password", { currentPassword, newPassword }),
  );
}

/** Matches MIN_PASSWORD_LENGTH in the service's auth.service.ts. */
export const MIN_PASSWORD_LENGTH = 10;
