/** Mirrors `PublicUser` and `LoginResult` in the service's auth.service.ts. */

export type UserRole = "viewer" | "admin";

/** What `POST /auth/login` returns alongside the token. */
export interface SessionUser {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
}

/** The fuller record from `GET /auth/me` and the admin user list. */
export interface PublicUser extends SessionUser {
  isActive: boolean;
  /** ISO 8601, or null for an account that has never signed in. */
  lastLoginAt: string | null;
  createdAt: string;
}

export interface LoginResult {
  token: string;
  /** Seconds until the token expires; the service defaults to 12 hours. */
  expiresIn: number;
  user: SessionUser;
}

export interface ChangePasswordResult {
  ok: boolean;
  message: string;
  /** Always true: changing a password invalidates every token, including this one. */
  reloginRequired: boolean;
}
