import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingState({ label = "กำลังโหลดข้อมูล…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12", className)} role="status">
      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/** Row-shaped placeholder, so a table does not collapse and jump while loading. */
export function TableSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="กำลังโหลดตาราง">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }, (_, colIndex) => (
            <Skeleton key={colIndex} className={cn("h-6 flex-1", colIndex === 0 && "flex-[2]")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title = "ไม่พบข้อมูล",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <div className="rounded-full bg-muted p-3">
        <Inbox className="h-5 w-5 text-muted-foreground" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const message =
    apiError?.message ?? (error instanceof Error ? error.message : "เกิดข้อผิดพลาดที่ไม่รู้จัก");

  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <div className="rounded-full bg-destructive/10 p-3">
        <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-destructive">โหลดข้อมูลไม่สำเร็จ</p>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        {apiError ? (
          <p className="font-mono text-xs text-muted-foreground">
            {apiError.code}
            {apiError.status === null ? "" : ` · HTTP ${apiError.status}`}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          ลองใหม่
        </Button>
      ) : null}
    </div>
  );
}

/** Non-blocking notices the service attaches to a response. */
export function WarningList({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <ul className="space-y-0.5 text-xs text-foreground/80">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}
