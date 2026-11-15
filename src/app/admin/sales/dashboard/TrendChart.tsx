// 在庫の指標の推移の簡単な折れ線(A-05 G01)。新しい部品を入れず SVG で描く(【仮】00_仮決め一覧 A-05-仮-05)。
// 記録の無い日はつながない(日付が1日より離れたら線を切る)。サーバーの部品(DBは読まない)。
import { diffDays } from "@/utils/salesPeriod";

export function TrendChart({
  title,
  points,
  format,
}: {
  title: string;
  points: { date: string; value: number | null }[];
  format: (v: number) => string;
}) {
  const W = 480;
  const H = 140;
  const PAD = { l: 8, r: 8, t: 12, b: 20 };
  const valid = points.filter((p): p is { date: string; value: number } => p.value !== null);
  if (valid.length === 0)
    return (
      <figure className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
        <figcaption className="text-sm font-bold">{title}</figcaption>
        <p className="text-sm text-ink-muted">記録がありません。</p>
      </figure>
    );
  const first = valid[0].date;
  const span = Math.max(1, diffDays(first, valid[valid.length - 1].date));
  const max = Math.max(...valid.map((p) => p.value));
  const min = Math.min(0, ...valid.map((p) => p.value));
  const x = (date: string) => PAD.l + (diffDays(first, date) / span) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (max === min ? 0.5 : 1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);

  // 記録のある日が続いている区間ごとに線を引く
  const segments: { date: string; value: number }[][] = [];
  for (const p of valid) {
    const last = segments[segments.length - 1];
    if (last && diffDays(last[last.length - 1].date, p.date) <= 1) last.push(p);
    else segments.push([p]);
  }
  const latest = valid[valid.length - 1];

  return (
    <figure className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3">
      <figcaption className="flex justify-between text-sm">
        <span className="font-bold">{title}</span>
        <span className="tabular-nums text-ink-muted">最新 {format(latest.value)}・最大 {format(max)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}の推移`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="stroke-line" strokeWidth={1} />
        {segments.map((seg, i) =>
          seg.length === 1 ? (
            <circle key={i} cx={x(seg[0].date)} cy={y(seg[0].value)} r={3} className="fill-primary" />
          ) : (
            <polyline
              key={i}
              points={seg.map((p) => `${x(p.date)},${y(p.value)}`).join(" ")}
              fill="none"
              className="stroke-primary"
              strokeWidth={2}
            />
          )
        )}
        <text x={PAD.l} y={H - 4} className="fill-ink-muted" fontSize={11}>
          {first.slice(5).replace("-", "/")}
        </text>
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="fill-ink-muted" fontSize={11}>
          {latest.date.slice(5).replace("-", "/")}
        </text>
      </svg>
    </figure>
  );
}
