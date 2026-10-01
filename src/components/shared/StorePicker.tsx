import { useMemo, useState } from "react";
import { Check, ChevronDown, Store, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useStores } from "@/hooks/useGmvReportData";
import { useFilterStore } from "@/store/filterStore";
import { formatDateLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const VISIBLE_LIMIT = 100;

export function StorePicker() {
  const storeIds = useFilterStore((state) => state.storeIds);
  const setStoreIds = useFilterStore((state) => state.setStoreIds);
  const { data: stores, isLoading, error } = useStores();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const all = useMemo(() => stores ?? [], [stores]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (store) =>
        (store.storeName ?? "").toLowerCase().includes(needle) ||
        store.storeId.toLowerCase().includes(needle),
    );
  }, [all, search]);

  const visible = filtered.slice(0, VISIBLE_LIMIT);
  const selected = new Set(storeIds);

  function toggle(storeId: string): void {
    const next = new Set(selected);
    if (next.has(storeId)) next.delete(storeId);
    else next.add(storeId);
    // Selecting every store is the same query as selecting none, so collapse to the empty "all"
    // form and keep one representation of that state
    setStoreIds(next.size === all.length ? [] : [...next]);
  }

  const label = (() => {
    if (storeIds.length === 0) return `ทุกร้าน${all.length ? ` (${all.length})` : ""}`;
    if (storeIds.length === 1) {
      const store = all.find((s) => s.storeId === storeIds[0]);
      return store?.storeName ?? storeIds[0]!;
    }
    return `${storeIds.length} ร้าน`;
  })();

  if (error) {
    return <span className="text-xs text-destructive">โหลดรายชื่อร้านไม่สำเร็จ</span>;
  }

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
          disabled={isLoading}
          className={cn("max-w-64 justify-between font-normal", storeIds.length > 0 && "border-primary/50")}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{isLoading ? "กำลังโหลดร้าน…" : label}</span>
          </span>
          <span className="flex items-center gap-1">
            {storeIds.length > 0 ? (
              <span
                role="button"
                tabIndex={0}
                aria-label="เลือกทุกร้าน"
                className="rounded-sm p-0.5 hover:bg-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  setStoreIds([]);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    event.preventDefault();
                    setStoreIds([]);
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
            placeholder="ค้นหาร้าน…"
            className="h-8"
            autoFocus
          />
        </div>

        <div className="border-b border-border p-1">
          <button
            type="button"
            onClick={() => {
              setStoreIds([]);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <Check
              className={cn("h-3.5 w-3.5 shrink-0", storeIds.length === 0 ? "opacity-100" : "opacity-0")}
              aria-hidden
            />
            <span className="font-medium">ทุกร้าน</span>
            <span className="ml-auto text-xs text-muted-foreground">{all.length} ร้าน</span>
          </button>
        </div>

        <div className="scrollbar-thin max-h-72 overflow-y-auto p-1">
          {visible.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">ไม่พบร้าน</p>
          ) : (
            visible.map((store) => {
              const isSelected = selected.has(store.storeId);
              return (
                <button
                  key={store.storeId}
                  type="button"
                  onClick={() => toggle(store.storeId)}
                  className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-input",
                      isSelected && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {isSelected ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{store.storeName ?? store.storeId}</span>
                    <span className="block text-xs text-muted-foreground">
                      {store.lastDate
                        ? `ข้อมูลถึง ${formatDateLabel(store.lastDate)}`
                        : "ยังไม่มีข้อมูลที่ sync แล้ว"}
                    </span>
                  </span>
                </button>
              );
            })
          )}

          {filtered.length > VISIBLE_LIMIT ? (
            <p className="px-2 py-2 text-center text-xs text-muted-foreground">
              แสดง {VISIBLE_LIMIT} จาก {filtered.length} ร้าน - พิมพ์เพื่อค้นหาต่อ
            </p>
          ) : null}
        </div>

        {storeIds.length > 0 ? (
          <div className="border-t border-border p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setStoreIds([])}>
              ล้างที่เลือก ({storeIds.length})
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
