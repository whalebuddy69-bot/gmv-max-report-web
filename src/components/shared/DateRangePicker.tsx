import { useState } from "react";
import { DayPicker, type DateRange as DayPickerRange } from "react-day-picker";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { daysAgo, formatDateLabel, fromIsoDate, toIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import "react-day-picker/style.css";

interface Preset {
  label: string;
  range: () => { from: string; to: string };
}

const PRESETS: readonly Preset[] = [
  { label: "7 วันล่าสุด", range: () => ({ from: daysAgo(6), to: toIsoDate(new Date()) }) },
  { label: "14 วันล่าสุด", range: () => ({ from: daysAgo(13), to: toIsoDate(new Date()) }) },
  { label: "30 วันล่าสุด", range: () => ({ from: daysAgo(29), to: toIsoDate(new Date()) }) },
  { label: "เดือนนี้", range: () => {
      const now = new Date();
      return { from: toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toIsoDate(now) };
    },
  },
  { label: "เดือนที่แล้ว", range: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toIsoDate(first), to: toIsoDate(last) };
    },
  },
];

export interface DateRangePickerProps {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
  className?: string;
}

export function DateRangePicker({ dateFrom, dateTo, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const selected: DayPickerRange | undefined = (() => {
    const from = fromIsoDate(dateFrom);
    if (!from) return undefined;
    return { from, to: fromIsoDate(dateTo) ?? undefined };
  })();

  function handleSelect(range: DayPickerRange | undefined): void {
    if (!range?.from) return;
    // While the user is mid-drag `to` is undefined
    const from = toIsoDate(range.from);
    const to = range.to ? toIsoDate(range.to) : from;
    onChange(from, to);
    if (range.to) setOpen(false);
  }

  const label =
    dateFrom === dateTo
      ? formatDateLabel(dateFrom)
      : `${formatDateLabel(dateFrom)} – ${formatDateLabel(dateTo)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("justify-start font-normal", className)}>
          <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0">
        <div className="flex">
          <div className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border p-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                variant="ghost"
                size="sm"
                className="justify-start font-normal"
                onClick={() => {
                  const { from, to } = preset.range();
                  onChange(from, to);
                  setOpen(false);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <div className="p-2">
            <DayPicker
              mode="range"
              numberOfMonths={2}
              defaultMonth={selected?.from}
              selected={selected}
              onSelect={handleSelect}
              disabled={{ after: new Date() }}
              showOutsideDays
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
