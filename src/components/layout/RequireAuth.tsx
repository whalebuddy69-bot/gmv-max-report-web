import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { LoadingState } from "@/components/shared/StateViews";
import { useAuthStore } from "@/store/authStore";

export function RequireAuth() {
  const { token, user, isRestoring, restore } = useAuthStore();
  const location = useLocation();

  useEffect(() => {
    if (token && !user && isRestoring) void restore();
  }, [token, user, isRestoring, restore]);

  if (isRestoring) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState label="กำลังตรวจสอบสิทธิ์…" />
      </div>
    );
  }

  if (!token || !user) {
    // `from` lets the login page send the user back where they were headed, and `replace` keeps
    // the guarded URL out of history so Back does not bounce
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
