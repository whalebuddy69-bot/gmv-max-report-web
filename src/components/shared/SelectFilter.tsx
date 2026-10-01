import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const VISIBLE_LIMIT = 200;

export interface FilterOption {
  value: string;
  label: string;
  /** Rendered right-aligned, a spend figure or a row count. */
  hint?: string;
}

export interface SelectFilterProps {
  label: string;
  options: readonly FilterOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  isLoading?: boolean;
  emptyHint?: string;
  className?: string;
}

export function SelectFilter({
  label,
  options,
  value,
  onChange,
  isLoading = false,
  emptyHint = "ไม่มีตัวเลือก",
  className,
}: SelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
    );
  }, [options, search]);

  const visible = filtered.slice(0, VISIBLE_LIMIT);
  const selected = value === null ? null : options.find((option) => option.value === value);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("max-w-56 justify-between font-normal", value !== null && "border-primary/50", className)}
        >
          <span className="truncate">{selected?.label ?? value ?? label}</span>
          <span className="flex items-center gap-1">
            {value !== null ? (
              <span
                role="button"
                tabIndex={0}
                aria-label={`ล้าง ${label}`}
                className="rounded-sm p-0.5 hover:bg-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  onChange(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    event.preventDefault();
                    onChange(null);
                  }
                }}
              >
                <X className="h-3 w-3" aria-hidden />
              </span>
            ) : null}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0">
        <div className="border-b border-border p-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`ค้นหา${label}…`}
            className="h-8"
            autoFocus
          />
        </div>

        <div className="scrollbar-thin max-h-72 overflow-y-auto p-1">
          {isLoading ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">กำลังโหลด…</p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">{emptyHint}</p>
          ) : (
            visible.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    // Clicking the current value clears it, so the filter can be removed
                    // without hunting for the small × on the trigger
                    onChange(isSelected ? null : option.value);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Check
                    className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  <span className="flex-1 truncate" title={option.label}>
                    {option.label}
                  </span>
                  {option.hint ? (
                    <span className="tabular shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                  ) : null}
                </button>
              );
            })
          )}

          {filtered.length > VISIBLE_LIMIT ? (
            <p className="px-2 py-2 text-center text-xs text-muted-foreground">
              แสดง {VISIBLE_LIMIT} จาก {filtered.length} รายการ - พิมพ์เพื่อค้นหาต่อ
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
