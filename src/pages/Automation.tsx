import { useQuery } from "@tanstack/react-query";
import { Clock3, RefreshCw } from "lucide-react";
import { fetchAutomationOverview } from "@/api/automation";
import { ApiError } from "@/api/client";
import { CreatorOverviewDashboard, automationAccessDenied } from "@/components/automation/CreatorOverviewDashboard";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared/StateViews";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BANGKOK } from "@/lib/automation";
import { useAuthStore } from "@/store/authStore";

const time = new Intl.DateTimeFormat("th-TH", { timeZone: BANGKOK, dateStyle: "medium", timeStyle: "short" });
const formatTime = (date: string) => time.format(new Date(date));
const SECTION = "min-w-0 rounded-xl border border-border bg-card p-4 sm:p-5";

export function AutomationPage() {
  const userId = useAuthStore((state) => state.user?.id);
  const overview = useQuery({
    queryKey: ["automation", "overview", userId],
    queryFn: ({ signal }) => fetchAutomationOverview(signal),
    enabled: userId !== undefined,
    gcTime: 0,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => automationAccessDenied(query.state.error) ? false : 60_000,
  });
  // Transient overview errors must not hide Stop for a selected account.
  // Revoked credentials are different: do not render retained account data.
  const data = !automationAccessDenied(overview.error) ? overview.data ?? null : null;
  const now = Date.now();
  async function syncOverview() {
    const refreshed = await overview.refetch({ cancelRefetch: false });
    return refreshed.isSuccess ? refreshed.data ?? null : null;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-muted/35">
      <div className="mx-auto grid w-full min-w-0 max-w-[1680px] gap-3 p-3 sm:gap-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
              <Badge variant="secondary">LIVE GMV Max</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">ค้นหาแคมเปญ LIVE ที่เปิดสวิตช์ และจัดการบัญชี Creator ที่ตั้งค่าไว้</p>
          </div>
          <Button type="button" variant="outline" className="min-h-10" onClick={() => void overview.refetch()} disabled={overview.isFetching || automationAccessDenied(overview.error)}>
            <RefreshCw className="h-4 w-4" aria-hidden /> อัปเดตสถานะ
          </Button>
        </div>
        {overview.isPending ? <LoadingState label="กำลังตรวจสอบสิทธิ์และสถานะแคมเปญ…" /> : overview.isError && !data ? (
          <div className={SECTION}>
            {overview.error instanceof ApiError && overview.error.status === 403 ? (
              <EmptyState title="บัญชีนี้ยังไม่ได้รับสิทธิ์ Automation" description="สิทธิ์ดูรายงานเดิมไม่เท่ากับสิทธิ์ดูข้อมูล Creator กรุณาติดต่อผู้ดูแล" />
            ) : overview.error instanceof ApiError && overview.error.status === 404 ? (
              <EmptyState title="ยังไม่ได้เปิดแหล่งข้อมูล Automation" description="แท็บนี้จะไม่แสดงข้อมูลตัวอย่างเป็นสถานะจริง" />
            ) : <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />}
          </div>
        ) : data ? (
          <>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 className="h-4 w-4" aria-hidden /> ตรวจข้อมูลล่าสุด {formatTime(data.checkedAt)} (เวลาไทย) · อัปเดตประมาณทุก 1 นาที
            </p>
            {overview.isError && <p role="status" className="text-xs text-muted-foreground">รีเฟรชภาพรวมไม่สำเร็จ · คำสั่งยังต้องตรวจข้อมูลและสิทธิ์ล่าสุด</p>}
            {userId !== undefined && <CreatorOverviewDashboard key={userId} data={data} userId={userId} now={now}
              onSync={syncOverview} onRefreshCampaign={() => void overview.refetch()} />}
          </>
        ) : null}
      </div>
    </div>
  );
}
