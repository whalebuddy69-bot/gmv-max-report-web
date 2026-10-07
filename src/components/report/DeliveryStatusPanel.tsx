import { useId } from "react";
import { DELIVERY_STATUS_CATALOG, deliveryStatusFilterOptions } from "@/lib/creativeStatus";
import { cn } from "@/lib/utils";

export interface DeliveryStatusPanelProps {
  value: string | null;
  onChange: (value: string | null) => void;
  counts: Record<string, number> | null;
  isFetching?: boolean;
  disabled?: boolean;
}

/** A server-side detail filter. It intentionally does not change Overall / KPI cards. */
export function DeliveryStatusPanel({ value, onChange, counts, isFetching = false, disabled = false }: DeliveryStatusPanelProps) {
  const id = useId();
  const options = deliveryStatusFilterOptions(counts);
  const supported = counts !== null;
  const total = supported ? options.reduce((sum, option) => sum + (option.count ?? 0), 0) : null;
  const countLabel = (count: number | null) => count === null ? "—" : count.toLocaleString("th-TH");

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-3" aria-label="Delivery status" aria-busy={isFetching}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Delivery status</h3>
          <p id={`${id}-scope`} className="mt-1 text-xs text-muted-foreground">
            สถานะล่าสุดที่ระบบมี ไม่ใช่ Exploration / Outstanding · กรองเฉพาะตารางชิ้นงานและ Excel ไม่เปลี่ยน Overall
          </p>
          <p className="mt-1 text-xs text-muted-foreground">จำนวนเป็นแถวชิ้นงาน ไม่ใช่วิดีโอไม่ซ้ำ · ชิ้นงานเดียวอาจอยู่หลายแคมเปญหรือสินค้า · รวมการ์ดสินค้าหากไม่ได้กรองเฉพาะ VIDEO</p>
        </div>
        <div className="w-full sm:w-80">
          <label htmlFor={id} className="mb-1 block text-xs font-medium">กรอง Delivery status</label>
          <select
            id={id}
            aria-describedby={`${id}-scope ${id}-availability`}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            value={value ?? ""}
            disabled={disabled || !supported}
            onChange={(event) => onChange(event.target.value || null)}
          >
            <option value="">ทุกสถานะ ({countLabel(total)})</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label} · {option.meaning} ({countLabel(option.count)})</option>
            ))}
          </select>
        </div>
      </div>
      <p id={`${id}-availability`} className="mt-2 text-xs text-muted-foreground" role="status">
        {isFetching ? "กำลังตรวจสอบจำนวนสถานะในขอบเขตที่เลือก…"
          : supported ? "จำนวนครอบคลุมทุกหน้าในร้านค้าและช่วงวันที่ที่เลือก ไม่ใช่เฉพาะหน้านี้"
            : "ยังไม่มีข้อมูลจำนวนสถานะจาก API — ยังใช้ตัวกรองไม่ได้ และไม่ได้หมายความว่าจำนวนเป็นศูนย์"}
      </p>
      <details className="mt-2 border-t border-border pt-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">ความหมายของทั้ง 9 สถานะ</summary>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {DELIVERY_STATUS_CATALOG.map((status) => (
            <div key={status.value}>
              <dt><span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", status.badgeClassName)}>{status.label}</span></dt>
              <dd className="mt-1 text-xs text-muted-foreground">{status.meaning}<span className="mt-0.5 block break-all font-mono text-[10px]">{status.value}</span></dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Unknown คือ API ไม่ส่งสถานะ · Other คือค่าใหม่ที่ระบบยังไม่มีคำอธิบาย · สถานะนำส่งไม่ใช่คะแนนคุณภาพ และไม่ได้รับประกันผลลัพธ์เมื่อเพิ่มงบ</p>
      </details>
    </section>
  );
}
