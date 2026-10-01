import { useState } from "react";
import { KeyRound, LogOut, User as UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { useAuthStore } from "@/store/authStore";

export function UserMenu() {
  const { user, logout } = useAuthStore();
  const [changingPassword, setChangingPassword] = useState(false);

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 font-normal">
            <UserIcon className="h-4 w-4" aria-hidden />
            <span className="max-w-40 truncate">{user.name ?? user.email}</span>
            {user.role === "admin" ? <Badge variant="secondary">admin</Badge> : null}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="font-normal normal-case">
            <span className="block truncate text-sm text-foreground">{user.name ?? "ไม่ได้ตั้งชื่อ"}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1 h-px bg-border" />

          <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
            <KeyRound className="h-4 w-4" aria-hidden />
            เปลี่ยนรหัสผ่าน
          </DropdownMenuItem>

          <DropdownMenuItem onSelect={() => logout()}>
            <LogOut className="h-4 w-4" aria-hidden />
            ออกจากระบบ
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {changingPassword ? <ChangePasswordDialog onClose={() => setChangingPassword(false)} /> : null}
    </>
  );
}
