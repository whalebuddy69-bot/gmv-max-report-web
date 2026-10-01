import { ArrowDown, ArrowUp, HelpCircle, Minus } from "lucide-react";
import type { SummaryResponse, SummaryTotals, ValueFormat } from "@/types/report";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateLabel, formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CardSpec {
  key: keyof SummaryTotals;
  label: string;
  format: ValueFormat;
  higherIsBetter: boolean;
  formula?: string;
}

const CARDS: readonly CardSpec[] = [
  { key: "grossRevenue", label: "Gross revenue", format: "currency", higherIsBetter: true },
  { key: "orders", label: "SKU orders", format: "integer", higherIsBetter: true },
  {
    key: "roi",
    label: "ROI",
    format: "ratio",
    higherIsBetter: true,
    formula: "SUM(Gross revenue) / SUM(Cost)",
  },
  { key: "cost", label: "Cost", format: "currency", higherIsBetter: false },
  {
    key: "costPerOrder",
    label: "Cost per order",
    format: "currency",
    higherIsBetter: false,
    formula: "SUM(Cost) / SUM(SKU orders)",
  },
  { key: "campaigns", label: "Campaigns with data", format: "integer", higherIsBetter: true },
];

/** Video and creator counts, shown after the six above and only where they mean what they say */
const CONTENT_CARDS: readonly CardSpec[] = [
  {
    key: "totalVideos",
    label: "Videos advertised",
    format: "integer",
    higherIsBetter: true,
    formula:
      "จำนวนวิดีโอที่มีการยิงแอดในช่วงที่เลือก - ไม่ใช่คลังวิดีโอทั้งหมดของร้าน " +
      "GMV Max ไม่มี endpoint ที่คืนคลังทั้งร้าน วิดีโอที่ไม่เคยถูกยิงแอดจึงไม่ถูกนับ",
  },
  {
    key: "videosWithSales",
    label: "Videos with sales",
    format: "integer",
    higherIsBetter: true,
    formula: "วิดีโอที่ทำ SKU orders ได้มากกว่า 0 ในช่วงที่เลือก",
  },
  {
    key: "creatorsWithSales",
    label: "Creators with sales",
    format: "integer",
    higherIsBetter: true,
    formula:
      "จำนวนบัญชี TikTok ที่วิดีโอทำ SKU orders ได้มากกว่า 0 - " +
      "โพสต์ของร้านเองไม่มีชื่อบัญชีติดมา จึงเพิ่ม Videos with sales แต่ไม่เพิ่มการ์ดนี้",
  },
];

/** Percent change, or null when the baseline is zero or missing and a ratio is meaningless. */
function changePct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** A figure the summary endpoint does not return, appended to the same row */
export interface ExtraCard {
  key: string;
  label: string;
  value: string;
  /** Shown where a delta would be. These have no previous period to compare against. */
  note: string;
}

export interface SummaryCardsProps {
  summary: SummaryResponse | undefined;
  isLoading: boolean;
  /** Product tab only, see CONTENT_CARDS for why they are not shown beside Live. */
  content?: boolean;
  extra?: readonly ExtraCard[];
  className?: string;
}

export function SummaryCards({
  summary,
  isLoading,
  content = false,
  extra = [],
  className,
}: SummaryCardsProps) {
  const cards = content ? [...CARDS, ...CONTENT_CARDS] : CARDS;

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 lg:grid-cols-3",
        // full class names so Tailwind can find them
        extra.length > 0 ? "xl:grid-cols-7" : "xl:grid-cols-6",
        className,
      )}
    >
      {cards.map((card) => {
        const value = summary?.current[card.key] ?? null;
        const delta = changePct(value, summary?.previous[card.key] ?? null);

        return (
          <Card key={card.key}>
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-1.5">
                <span className="truncate">{card.label}</span>
                {card.formula ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground/70 hover:text-foreground">
                        <HelpCircle className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">สูตรของ {card.label}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{card.formula}</TooltipContent>
                  </Tooltip>
                ) : null}
              </CardTitle>
            </CardHeader>

            <CardContent>
              {isLoading ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                <>
                  {/* The full figure, not a compacted one */}
                  <p
                    className="tabular text-xl font-semibold [@media(max-width:1600px)]:text-lg"
                    title={String(value ?? "")}
                  >
                    {formatValue(value, card.format)}
                  </p>
                  <DeltaBadge
                    delta={delta}
                    higherIsBetter={card.higherIsBetter}
                    previousRange={summary?.previousRange}
                  />
                </>
              )}
            </CardContent>
          </Card>
        );
      })}

      {extra.map((card) => (
        <Card key={card.key}>
          <CardHeader className="pb-1">
            <CardTitle>
              <span className="truncate">{card.label}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-7 w-24" />
            ) : (
              <>
                <p className="tabular text-xl font-semibold [@media(max-width:1600px)]:text-lg">
                  {card.value}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{card.note}</p>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DeltaBadge({
  delta,
  higherIsBetter,
  previousRange,
}: {
  delta: number | null;
  higherIsBetter: boolean;
  previousRange: { from: string; to: string } | undefined;
}) {
  if (delta === null) {
    return <p className="mt-0.5 text-xs text-muted-foreground">ไม่มีข้อมูลช่วงก่อนหน้า</p>;
  }

  // Under half a percent, direction is noise; showing an arrow implies a trend.
  const flat = Math.abs(delta) < 0.5;
  const good = higherIsBetter ? delta > 0 : delta < 0;
  const Icon = flat ? Minus : delta > 0 ? ArrowUp : ArrowDown;

  const title = previousRange
    ? `เทียบกับ ${formatDateLabel(previousRange.from)} – ${formatDateLabel(previousRange.to)}`
    : undefined;

  return (
    <p
      className={cn(
        "mt-0.5 flex items-center gap-0.5 text-xs",
        flat ? "text-muted-foreground" : good ? "text-success" : "text-destructive",
      )}
      title={title}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="tabular">{Math.abs(delta).toFixed(1)}%</span>
      <span className="text-muted-foreground">เทียบช่วงก่อน</span>
    </p>
  );
}
