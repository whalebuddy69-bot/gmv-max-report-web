import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadWorkbook, type WorkbookSheet } from "@/lib/exportExcel";
import { cn } from "@/lib/utils";

export interface ExportButtonProps {
  /** Builds the sheets to write */
  buildSheets: (onProgress: (fetched: number, total: number) => void) =>
    | WorkbookSheet<never>[]
    | Promise<WorkbookSheet<never>[]>;
  fileName: string;
  /** Row count, used only to decide whether to disable the button. */
  rowCount: number;
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm";
  className?: string;
}

export function ExportButton({
  buildSheets,
  fileName,
  rowCount,
  label: labelText = "ส่งออก Excel",
  variant = "outline",
  size = "sm",
  className,
}: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      // Let the spinner render before the synchronous write locks the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const sheets = await buildSheets((fetched, total) => setProgress({ fetched, total }));
      if (sheets.every((sheet) => sheet.rows.length === 0)) {
        setError("ไม่มีข้อมูลให้ส่งออก");
        return;
      }
      downloadWorkbook(sheets, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "สร้างไฟล์ไม่สำเร็จ");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const label = (() => {
    if (!busy) return labelText;
    if (progress && progress.total > progress.fetched) {
      return `กำลังดึง ${progress.fetched.toLocaleString("th-TH")}/${progress.total.toLocaleString("th-TH")}…`;
    }
    return "กำลังสร้างไฟล์…";
  })();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        disabled={busy || rowCount === 0}
        title={rowCount === 0 ? "ไม่มีข้อมูลให้ส่งออก" : `ส่งออก ${rowCount.toLocaleString("th-TH")} แถว`}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
        {label}
      </Button>
    </div>
  );
}
