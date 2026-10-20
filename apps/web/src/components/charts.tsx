'use client';
import { useId } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';

/** Tooltip drawn like the rest of the app's popovers. */
function ChartTooltip({ active, payload, label, format }: TooltipProps<number, string> & { format?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/70 bg-popover px-3 py-2 text-xs shadow-pop">
      <p className="mb-0.5 font-medium text-foreground">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-primary" />
          {p.name}: <span className="font-semibold tabular text-foreground">{format ? format(Number(p.value)) : Number(p.value).toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * The app's bar chart: soft gradient bars in the clinic's main colour, rounded tops, light grid lines and a
 * card-style tooltip. `format` turns a value into the text shown in the tooltip (e.g. money).
 */
export function BarChartCard({
  data,
  name,
  xKey = 'name',
  yKey = 'value',
  format,
  axisFormat,
  integers,
  tickInterval,
  left = -10,
}: {
  data: Record<string, unknown>[];
  name: string;
  xKey?: string;
  yKey?: string;
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  integers?: boolean;
  tickInterval?: number;
  left?: number;
}) {
  const gid = useId().replace(/:/g, '');
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left, top: 8, right: 4 }} barCategoryGap="22%">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.95} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={tickInterval} />
        <YAxis allowDecimals={!integers} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} tickFormatter={axisFormat} width={axisFormat ? 48 : 36} />
        <Tooltip cursor={{ fill: 'hsl(var(--primary) / 0.07)' }} content={<ChartTooltip format={format} />} />
        <Bar dataKey={yKey} name={name} fill={`url(#${gid})`} radius={[8, 8, 3, 3]} maxBarSize={48} animationDuration={700} />
      </BarChart>
    </ResponsiveContainer>
  );
}
