"use client";

import { useStaffFormat } from "@/hooks/use-staff-format";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function TrendChart({
  title,
  icon: Icon,
  data,
  valueKey,
  color,
  valueFormatter,
  isLoading,
  emptyMessage,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  data: Record<string, string | number>[];
  valueKey: string;
  color: string;
  valueFormatter: (value: number) => string;
  isLoading: boolean;
  emptyMessage: string;
}) {
  const fmt = useStaffFormat();
  const formatDayLabel = (date: string) => fmt.day(date, { day: "numeric", month: "short" });
  // Short axis ticks leave room for the chart. The tooltip shows the full amount.
  const compactNumber = new Intl.NumberFormat(fmt.localeTag, { notation: "compact", maximumFractionDigits: 1 });
  const hasData = data.some((d) => Number(d[valueKey]) > 0);

  return (
    <Card className="flex flex-col gap-2 p-4">
      <h2 className="flex items-center gap-2 text-base font-medium text-foreground">
        <Icon className="h-[18px] w-[18px] text-muted-foreground" />
        {title}
      </h2>

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl lg:h-44" />
      ) : !hasData ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="h-44 lg:h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDayLabel}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v: number) => compactNumber.format(v)}
              />
              <Tooltip
                formatter={(value: number) => valueFormatter(value)}
                labelFormatter={formatDayLabel}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey={valueKey}
                stroke={color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
