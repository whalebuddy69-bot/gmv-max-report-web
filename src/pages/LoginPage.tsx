import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/store/authStore";

export function LoginPage() {
  const { user, isLoggingIn, loginError, login, clearLoginError } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await login(email.trim(), password);
  }

  if (user) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold tracking-tight">GMV Max Analytics</h1>
          <p className="text-sm text-muted-foreground">เข้าสู่ระบบเพื่อดูรายงาน</p>
        </div>

        <Card>
          <CardContent className="p-5">
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-sm font-medium">
                  อีเมล
                </label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (loginError) clearLoginError();
                  }}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="password" className="text-sm font-medium">
                  รหัสผ่าน
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (loginError) clearLoginError();
                  }}
                  autoComplete="current-password"
                  required
                />
              </div>

              {loginError ? (
                <div
                  role="alert"
                  className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  <p className="text-xs text-foreground/80">{loginError}</p>
                </div>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={isLoggingIn || email.trim() === "" || password === ""}
              >
                {isLoggingIn ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <LogIn className="h-4 w-4" aria-hidden />
                )}
                {isLoggingIn ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบเพื่อรีเซ็ตให้
        </p>
      </div>
    </div>
  );
}
