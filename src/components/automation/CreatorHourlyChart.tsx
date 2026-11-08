import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatHour } from "@/lib/automation";
import { formatCompact, formatValue } from "@/lib/format";
import type { ValueFormat } from "@/types/report";

export default function CreatorHourlyChart({ rows, label, format }: {
  rows: { minute: number; value: number | null }[];
  label: string;
  format: ValueFormat;
}) {
  return <div className="mt-2 h-[240px] min-w-0 sm:h-[300px]" role="img" aria-label={`กราฟ ${label} รายชั่วโมง`}>
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 12, right: 14, bottom: 8, left: 2 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis type="number" dataKey="minute" domain={[0, 1439]} ticks={[0, 360, 720, 1080, 1380]} tickFormatter={formatHour} minTickGap={18} tick={{ fontSize: 11 }} />
        <YAxis width={64} tickFormatter={(value: number) => formatCompact(value, format)} tick={{ fontSize: 11 }} />
        <Tooltip labelFormatter={(value: number) => formatHour(value)} formatter={(value: number) => [formatValue(value, format), label]} />
        <Line name={label} type="linear" dataKey="value" stroke="var(--color-primary)" strokeWidth={2} connectNulls={false} dot={{ r: 2.5 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
