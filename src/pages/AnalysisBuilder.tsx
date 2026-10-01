import { GlobalFilterBar } from "@/components/shared/GlobalFilterBar";
import { EmptyState } from "@/components/shared/StateViews";

export function AnalysisBuilder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GlobalFilterBar />
      <EmptyState
        title="ตัวสร้างการวิเคราะห์ยังไม่พร้อมใช้งาน"
        description="ส่วนคำนวณ pivot, state และการส่งออก Excel เสร็จแล้ว เหลือส่วน UI ลากวาง"
      />
    </div>
  );
}
