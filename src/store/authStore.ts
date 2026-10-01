import { create } from "zustand";
import type { SessionUser } from "@/types/auth";
import * as authApi from "@/api/auth";
import { ApiError, setAuthFailureHandler, setAuthToken, toApiError } from "@/api/client";

const TOKEN_KEY = "gmv-max-auth-token";

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  /** True until the initial `/auth/me` settles, so the router does not flash the login page. */
  isRestoring: boolean;
  loginError: string | null;
  isLoggingIn: boolean;

  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  restore: () => Promise<void>;
  clearLoginError: () => void;
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private-mode Safari and hardened browser settings can throw here
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* see readStoredToken */
  }
}

const initialToken = readStoredToken();
// Set before the first request can go out, so a reload does not race the interceptor.
setAuthToken(initialToken);

export const useAuthStore = create<AuthState>((set, get) => ({
  token: initialToken,
  user: null,
  isRestoring: initialToken !== null,
  loginError: null,
  isLoggingIn: false,

  login: async (email, password) => {
    set({ isLoggingIn: true, loginError: null });
    try {
      const result = await authApi.login(email, password);
      writeStoredToken(result.token);
      setAuthToken(result.token);
      set({ token: result.token, user: result.user, isLoggingIn: false, loginError: null });
      return true;
    } catch (err) {
      const apiError = toApiError(err);
      set({ isLoggingIn: false, loginError: apiError.message, token: null, user: null });
      writeStoredToken(null);
      setAuthToken(null);
      return false;
    }
  },

  logout: () => {
    writeStoredToken(null);
    setAuthToken(null);
    set({ token: null, user: null, loginError: null, isRestoring: false });
  },

  restore: async () => {
    const { token } = get();
    if (!token) {
      set({ isRestoring: false });
      return;
    }

    try {
      const user = await authApi.fetchMe();
      set({ user, isRestoring: false });
    } catch (err) {
      const apiError = err instanceof ApiError ? err : toApiError(err);
      // Only a rejected session clears the token
      if (apiError.isAuthFailure) {
        get().logout();
        return;
      }
      set({ isRestoring: false });
    }
  },

  clearLoginError: () => set({ loginError: null }),
}));

// Any 401 from any endpoint ends the session
setAuthFailureHandler(() => {
  const { token, logout } = useAuthStore.getState();
  if (token) logout();
});
