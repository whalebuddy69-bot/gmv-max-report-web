import type { PromotionType } from "@/types/report";
import { cn } from "@/lib/utils";

const OPTIONS: ReadonlyArray<{ value: PromotionType; label: string; title: string }> = [
  { value: "PRODUCT", label: "Product", title: "Product GMV Max - โฆษณาวิดีโอ/การ์ดสินค้า" },
  { value: "LIVE", label: "LIVE", title: "Live GMV Max - โฆษณาห้องไลฟ์" },
];

export function PromotionScopeSwitch({
  value,
  onChange,
}: {
  value: PromotionType;
  onChange: (value: PromotionType) => void;
}) {
  return (
    <div
      className="inline-flex h-8 items-center rounded-md border border-border bg-muted/40 p-0.5"
      role="group"
      aria-label="ประเภทแคมเปญ"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded px-3 py-1 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
