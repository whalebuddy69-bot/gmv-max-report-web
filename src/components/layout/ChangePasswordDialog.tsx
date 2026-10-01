import { useState, type FormEvent } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MIN_PASSWORD_LENGTH, changePassword } from "@/api/auth";
import { toApiError } from "@/api/client";
import { useAuthStore } from "@/store/authStore";

/** Self-service password change */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const logout = useAuthStore((state) => state.logout);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit =
    currentPassword !== "" &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmPassword &&
    !busy;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
      // Every token is dead now, this one included.
      logout();
      onClose();
    } catch (err) {
      setError(toApiError(err).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">เปลี่ยนรหัสผ่าน</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          เมื่อเปลี่ยนสำเร็จ ระบบจะออกจากระบบทุกอุปกรณ์ และต้องเข้าสู่ระบบใหม่
        </DialogDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="current-password" className="text-sm font-medium">
              รหัสผ่านปัจจุบัน
            </label>
            <Input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="new-password" className="text-sm font-medium">
              รหัสผ่านใหม่
            </label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              aria-describedby="new-password-hint"
            />
            <p
              id="new-password-hint"
              className={tooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
            >
              อย่างน้อย {MIN_PASSWORD_LENGTH} ตัวอักษร และต้องไม่ซ้ำกับรหัสเดิม
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirm-password" className="text-sm font-medium">
              ยืนยันรหัสผ่านใหม่
            </label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
            {mismatch ? <p className="text-xs text-destructive">รหัสผ่านไม่ตรงกัน</p> : null}
          </div>

          {error ? (
            <div
              role="alert"
              className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <p className="text-xs text-foreground/80">{error}</p>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              เปลี่ยนรหัสผ่าน
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
