import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const automationDisclosureFrame = "min-w-0 rounded-lg border border-border bg-card px-3 sm:px-4";

export function AutomationSwitchTrack({ checked }: { checked: boolean }) {
  return <span aria-hidden className={cn("relative block h-5 w-9 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted-foreground/40")}>
    <span className={cn("absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform", checked && "translate-x-4")} />
  </span>;
}

/** One full-width disclosure button; a live switch is an independent sibling, never nested in it. */
export function AutomationDisclosureRow({ title, titleId, status, expanded, controlsId, onToggle, disabled, trailingControl, layout }: {
  title: string;
  titleId?: string;
  status?: ReactNode;
  expanded: boolean;
  controlsId: string;
  onToggle: () => void;
  disabled?: boolean;
  trailingControl?: ReactNode;
  layout?: string;
}) {
  return <div className="relative min-w-0" data-layout={layout}>
    <button type="button" className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
      aria-expanded={expanded} aria-controls={controlsId} disabled={disabled} onClick={onToggle}>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
        <span id={titleId} className="text-sm font-semibold">{title}</span>
        {status != null && <span className="text-xs tabular-nums text-muted-foreground">{status}</span>}
      </span>
      <span aria-hidden className="flex shrink-0 items-center gap-1.5">
        {trailingControl != null && <span className="w-11" />}
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
      </span>
    </button>
    {trailingControl != null && <div className="absolute inset-y-0 right-[1.375rem] flex w-11 items-center justify-center">{trailingControl}</div>}
  </div>;
}

export function AutomationDisclosureBody({ id, expanded, children, className }: { id: string; expanded: boolean; children: ReactNode; className?: string }) {
  return <div id={id} hidden={!expanded} className={cn("border-t border-border pb-3 pt-2.5", className)}>
    {expanded && children}
  </div>;
}
