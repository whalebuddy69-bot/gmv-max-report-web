import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, SlidersHorizontal, Store } from "lucide-react";
import { UserMenu } from "./UserMenu";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/", label: "รายงานภาพรวม", icon: LayoutDashboard, end: true },
  // "วิเคราะห์เอง" (/analysis) is hidden until the builder UI exists
  { to: "/stores", label: "ร้านค้า", icon: Store, end: false },
  { to: "/automation", label: "Automation", icon: SlidersHorizontal, end: false },
] as const;

export function AppShell() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-2.5 sm:flex-nowrap sm:px-4">
        <span className="shrink-0 text-sm font-semibold tracking-tight">GMV Max Analytics</span>

        <nav aria-label="เมนูหลัก" className="order-3 flex w-full flex-wrap items-center gap-1 sm:order-none sm:w-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex min-h-10 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors sm:min-h-0 sm:px-3",
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

        <div className="ml-auto shrink-0">
          <UserMenu />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
