import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * The service rejects a `limit` above 1000 on the paged endpoints, so 500 is the largest safe
 * step
 */
const PAGE_SIZES = [25, 50, 100, 250, 500] as const;
const WINDOW = 2;

/** Local to this control: the service reports offset/limit/total, not pages. */
export interface PageInfo {
  page: number;
  pageSize: number;
  totalRows: number;
}

export interface PaginationProps {
  page: PageInfo;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  disabled?: boolean;
}

function pageNumbers(current: number, total: number): (number | "gap")[] {
  if (total <= 1) return [1];

  const pages = new Set<number>([1, total]);
  for (let p = current - WINDOW; p <= current + WINDOW; p += 1) {
    if (p >= 1 && p <= total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const output: (number | "gap")[] = [];
  let previous = 0;

  for (const p of sorted) {
    if (previous && p - previous > 1) output.push("gap");
    output.push(p);
    previous = p;
  }
  return output;
}

export function Pagination({ page, onPageChange, onPageSizeChange, disabled = false }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(page.totalRows / page.pageSize));
  const first = page.totalRows === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const last = Math.min(page.page * page.pageSize, page.totalRows);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-sm">
      <p className="text-xs text-muted-foreground">
        แสดง <span className="tabular">{first.toLocaleString("th-TH")}</span>–
        <span className="tabular">{last.toLocaleString("th-TH")}</span> จาก{" "}
        <span className="tabular font-medium text-foreground">{page.totalRows.toLocaleString("th-TH")}</span> แถว
      </p>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">ต่อหน้า</span>
          <Select
            value={String(page.pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="h-8 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={disabled || page.page <= 1}
            onClick={() => onPageChange(page.page - 1)}
            aria-label="หน้าก่อนหน้า"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>

          {pageNumbers(page.page, totalPages).map((entry, index) =>
            entry === "gap" ? (
              <span key={`gap-${index}`} className="px-1 text-xs text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={entry}
                variant={entry === page.page ? "default" : "ghost"}
                size="sm"
                className="tabular h-8 min-w-8 px-2"
                disabled={disabled}
                onClick={() => onPageChange(entry)}
                aria-current={entry === page.page ? "page" : undefined}
              >
                {entry}
              </Button>
            ),
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={disabled || page.page >= totalPages}
            onClick={() => onPageChange(page.page + 1)}
            aria-label="หน้าถัดไป"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
