import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Store } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "รายงานภาพรวม", icon: LayoutDashboard, end: true },
  // "วิเคราะห์เอง" (/analysis) is hidden until the builder UI exists
  { to: "/stores", label: "ร้านค้า", icon: Store, end: false },
] as const;

export function AppShell() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-4 border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold tracking-tight">GMV Max Analytics</span>

        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )
              }
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto">
          <UserMenu />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
