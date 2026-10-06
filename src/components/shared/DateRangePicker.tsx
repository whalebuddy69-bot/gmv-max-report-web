import { useEffect, useId, useState } from "react";
import { DayPicker } from "react-day-picker";
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toIsoDate } from "@/lib/format";
import { dateRangeError, dateRangePresets, inclusiveDayCount, parseCalendarDate, selectRangeDay } from "@/lib/dateRange";
import { cn } from "@/lib/utils";
import "react-day-picker/style.css";
import "./DateRangePicker.css";

export interface DateRangePickerProps {
  dateFrom: string;
  dateTo: string;
  onChange: (dateFrom: string, dateTo: string) => void;
  className?: string;
}

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthLabel = (date: Date) => toIsoDate(date).slice(0, 7);

function useCalendarMonthCount() {
  const [count, setCount] = useState(() => {
    const wideScreen = typeof window === "undefined" || window.matchMedia("(min-width: 768px)").matches;
    return wideScreen ? 2 : 1;
  });
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setCount(media.matches ? 2 : 1);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return count;
}

export function DateRangePicker({ dateFrom, dateTo, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: dateFrom, to: dateTo });
  const [month, setMonth] = useState(() => monthStart(parseCalendarDate(dateFrom) ?? new Date()));
  const [today, setToday] = useState(() => toIsoDate(new Date()));
  const numberOfMonths = useCalendarMonthCount();
  const id = useId();
  const todayDate = parseCalendarDate(today)!;
  const latestMonth = monthStart(todayDate);
  const error = dateRangeError(draft, today);
  const from = parseCalendarDate(draft.from);
  const to = parseCalendarDate(draft.to);
  const selected = from ? { from, to: to && to >= from ? to : undefined } : undefined;
  const days = error ? 0 : inclusiveDayCount(draft);

  function showMonth(date: Date) {
    setMonth(monthStart(date > latestMonth ? latestMonth : date));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const now = new Date();
      setToday(toIsoDate(now));
      setDraft({ from: dateFrom, to: dateTo });
      const start = parseCalendarDate(dateFrom) ?? now;
      setMonth(monthStart(start > now ? now : start));
    }
    setOpen(nextOpen);
  }

  function revealDate(value: string) {
    const date = parseCalendarDate(value);
    if (!date || date > todayDate) return;
    const nextPage = new Date(month.getFullYear(), month.getMonth() + numberOfMonths, 1);
    if (date < month || date >= nextPage) showMonth(date);
  }

  function applyRange() {
    if (dateRangeError(draft, toIsoDate(new Date()))) return;
    if (draft.from !== dateFrom || draft.to !== dateTo) onChange(draft.from, draft.to);
    setOpen(false);
  }

  const status = !draft.to && from
    ? "เลือกวันสิ้นสุด — คลิกวันเดิมอีกครั้งเพื่อเลือกวันเดียว"
    : error ?? `${days.toLocaleString("th-TH")} วัน · รวมวันเริ่มต้นและวันสิ้นสุด`;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm"
          aria-label={`เลือกช่วงวันที่ ${dateFrom} ถึง ${dateTo}`}
          className={cn("report-date-trigger justify-between font-normal", className)}>
          <span className="tabular">{dateFrom} <span className="px-1 text-muted-foreground">–</span> {dateTo}</span>
          <CalendarDays className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent id={`${id}-popover`} tabIndex={-1} className="report-date-popover p-0" collisionPadding={12}
        aria-label="เลือกช่วงวันที่รายงาน"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          // Do not open the software keyboard before a mobile user chooses to type.
          document.getElementById(`${id}-${numberOfMonths === 2 ? "from" : "popover"}`)?.focus({ preventScroll: true });
        }}>
        <form onSubmit={(event) => { event.preventDefault(); applyRange(); }}>
          <div className="report-date-layout">
            <div className="report-date-presets" role="group" aria-label="ช่วงวันที่ลัด">
              {dateRangePresets(todayDate).map((preset) => (
                <Button key={preset.label} type="button" variant="ghost" size="sm"
                  className="report-date-preset justify-start font-normal"
                  aria-pressed={preset.from === draft.from && preset.to === draft.to}
                  onClick={() => {
                    setDraft({ from: preset.from, to: preset.to });
                    showMonth(parseCalendarDate(preset.from)!);
                  }}>
                  {preset.label}
                </Button>
              ))}
            </div>

            <div className="report-date-main">
              <div className="report-date-inputs">
                {(["from", "to"] as const).map((field) => (
                  <div key={field}>
                    <label htmlFor={`${id}-${field}`} className="mb-1 block text-xs text-muted-foreground">
                      {field === "from" ? "วันที่เริ่มต้น" : "วันที่สิ้นสุด"} (ค.ศ.)
                    </label>
                    <Input id={`${id}-${field}`} value={draft[field]} placeholder="YYYY-MM-DD"
                      className="tabular" autoComplete="off" spellCheck={false} maxLength={10}
                      aria-describedby={`${id}-hint ${id}-status`}
                      aria-invalid={Boolean(draft[field] && (!parseCalendarDate(draft[field]) || draft[field] > today
                        || (field === "to" && from && to && to < from)))}
                      onChange={(event) => setDraft((range) => ({ ...range, [field]: event.target.value.trim() }))}
                      onBlur={() => revealDate(draft[field])} />
                  </div>
                ))}
              </div>
              <p id={`${id}-hint`} className="mb-2 text-xs text-muted-foreground">
                พิมพ์ YYYY-MM-DD หรือคลิกวันเริ่มต้น แล้วคลิกวันสิ้นสุด
              </p>

              <div className="report-date-calendars">
                <nav className="report-date-navigation" aria-label="เปลี่ยนเดือนปฏิทิน">
                  <div className="flex">
                    <Button type="button" variant="ghost" size="icon" aria-label="ปีก่อนหน้า" title="ปีก่อนหน้า"
                      onClick={() => showMonth(new Date(month.getFullYear() - 1, month.getMonth(), 1))}>
                      <ChevronsLeft className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label="เดือนก่อนหน้า" title="เดือนก่อนหน้า"
                      onClick={() => showMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  <div className="flex">
                    <Button type="button" variant="ghost" size="icon" aria-label="เดือนถัดไป" title="เดือนถัดไป"
                      disabled={month >= latestMonth}
                      onClick={() => showMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                      <ChevronRight className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label="ปีถัดไป" title="ปีถัดไป"
                      disabled={new Date(month.getFullYear() + 1, month.getMonth(), 1) > latestMonth}
                      onClick={() => showMonth(new Date(month.getFullYear() + 1, month.getMonth(), 1))}>
                      <ChevronsRight className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </nav>
                <DayPicker mode="range" numberOfMonths={numberOfMonths} month={month} onMonthChange={showMonth}
                  selected={selected} hideNavigation showOutsideDays weekStartsOn={0}
                  today={todayDate} disabled={{ after: todayDate }}
                  formatters={{ formatCaption: monthLabel }}
                  labels={{ labelDayButton: (date) => toIsoDate(date) }}
                  onSelect={(_range, day, modifiers) => {
                    if (!modifiers.disabled) setDraft((range) => selectRangeDay(range, toIsoDate(day)));
                  }} />
              </div>
            </div>
          </div>

          <div className="report-date-footer">
            <p id={`${id}-status`} role="status" aria-live="polite"
              className={cn("text-xs", error && draft.to ? "text-destructive" : "text-muted-foreground")}>
              {status}
            </p>
            <div className="flex shrink-0 justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>ยกเลิก</Button>
              <Button type="submit" size="sm" className="report-date-apply" disabled={Boolean(error)}>ใช้ช่วงวันที่นี้</Button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
