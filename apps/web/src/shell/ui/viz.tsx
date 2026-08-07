/**
 * Six shapes, drawn by hand.
 *
 * The app had no `<svg>` on a single page, and that — more than spacing, more than colour —
 * is why every screen read as a form. A number tells you what happened; a shape tells you
 * whether it is normal, which is the question anybody actually has.
 *
 * No chart library. The dependency budget is deliberately flat, and these six are the whole
 * vocabulary the product needs: a trend, a ratio against a whole, a mix, a rhythm over days,
 * a fraction of a target, and a split of a total. Anything a page wants beyond these is
 * almost always a sign that the page is asking too much at once.
 *
 * Everything here paints in `currentColor` or a passed token, so a chart inside a tinted card
 * inherits the card and neither has to know about the other.
 */

/** No data is a fact, and it renders as a sentence rather than as an empty axis. */
function Nothing({ height, children }: { height: number; children: string }) {
  return (
    <div className="viz-empty" style={{ height }}>
      {children}
    </div>
  );
}

/**
 * A trend.
 *
 * Deliberately axis-free: at this size the shape is the message and a labelled y-axis is
 * three more things to read for no more information. Where the exact figure matters it is
 * already set above the chart at --metric-hero.
 */
export function Spark({
  points,
  height = 54,
  tone = 'var(--accent)',
  fill = true,
  empty = 'Nothing logged yet',
}: {
  points: number[];
  height?: number;
  tone?: string;
  fill?: boolean;
  empty?: string;
}) {
  if (points.length < 2) return <Nothing height={height}>{empty}</Nothing>;

  const W = 320;
  const H = height;
  const pad = 4;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  // A flat series has no range to divide by. Draw it down the middle rather than at the top,
  // which is what a zero span would produce and would read as "at maximum".
  const span = hi - lo || 1;
  const at = (v: number, i: number) => {
    const x = (i / (points.length - 1)) * W;
    const y = hi === lo ? H / 2 : pad + (1 - (v - lo) / span) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const line = points.map(at).join(' L ');
  const id = `sp${points.length}-${Math.round(lo)}-${Math.round(hi)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} height={H} className="viz" preserveAspectRatio="none" aria-hidden="true">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={tone} stopOpacity="0.34" />
              <stop offset="1" stopColor={tone} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`M ${line} L ${W},${H} L 0,${H} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path
        d={`M ${line}`}
        fill="none"
        stroke={tone}
        strokeWidth="2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * A ratio against a whole, as an arc.
 *
 * A half-circle rather than a full ring because a percentage has a floor and a ceiling, and
 * an arc that visibly starts somewhere and ends somewhere says so. A full ring implies a
 * cycle.
 */
export function Gauge({
  value,
  label,
  tone = 'var(--accent)',
}: {
  /** 0–100. Clamped, because a bar that overshoots its own track is a bug you can see. */
  value: number;
  label?: string;
  tone?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const R = 46;
  const CX = 60;
  const CY = 68;
  const end = Math.PI * (1 - pct / 100);
  const x = CX + R * Math.cos(end);
  const y = CY - R * Math.sin(end);

  return (
    <svg viewBox="0 0 120 82" className="viz viz-gauge" role="img" aria-label={`${Math.round(pct)}%`}>
      <path
        d={`M ${CX - R},${CY} A ${R},${R} 0 0 1 ${CX + R},${CY}`}
        fill="none"
        stroke="var(--surface-sunken)"
        strokeWidth="11"
        strokeLinecap="round"
      />
      {pct > 0 && (
        <path
          d={`M ${CX - R},${CY} A ${R},${R} 0 0 1 ${x.toFixed(2)},${y.toFixed(2)}`}
          fill="none"
          stroke={tone}
          strokeWidth="11"
          strokeLinecap="round"
        />
      )}
      <text x={CX} y={CY - 6} textAnchor="middle" className="viz-figure">
        {Math.round(pct)}%
      </text>
      {label && (
        <text x={CX} y={CY + 12} textAnchor="middle" className="viz-caption">
          {label}
        </text>
      )}
    </svg>
  );
}

export interface Slice {
  label: string;
  value: number;
  tone: string;
}

/**
 * A mix, as a ring, with the total in the hole.
 *
 * The legend is not optional and is not rendered here: a ring without one is a decoration,
 * and putting the legend beside rather than inside is what keeps both readable. Callers lay
 * the two out together.
 */
export function Donut({ slices, total }: { slices: Slice[]; total?: number | string }) {
  const sum = slices.reduce((n, s) => n + s.value, 0);
  if (sum === 0) return <Nothing height={104}>Nothing on the board</Nothing>;

  const R = 37;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <svg viewBox="0 0 96 96" className="viz viz-donut" role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}>
      <circle cx="48" cy="48" r={R} fill="none" stroke="var(--surface-sunken)" strokeWidth="13" />
      {slices
        .filter((s) => s.value > 0)
        .map((s) => {
          const len = (s.value / sum) * C;
          // -90 puts the first slice at twelve o'clock; each one starts where the last ended.
          const rot = -90 + (offset / C) * 360;
          offset += len;
          return (
            <circle
              key={s.label}
              cx="48"
              cy="48"
              r={R}
              fill="none"
              stroke={s.tone}
              strokeWidth="13"
              // A 1px gap so two adjacent slices of the same weight are still two slices.
              strokeDasharray={`${Math.max(0, len - 1.5).toFixed(2)} ${C}`}
              transform={`rotate(${rot.toFixed(2)} 48 48)`}
            />
          );
        })}
      {total !== undefined && (
        <text x="48" y="54" textAnchor="middle" className="viz-figure">
          {total}
        </text>
      )}
    </svg>
  );
}

/**
 * A rhythm over days.
 *
 * The point of this shape is the *gaps*: a fortnight where two days carry everything and
 * eleven are empty is a fact no total can show you, and it is the fact that predicts a
 * month-end scramble. So a zero day draws as a flat stub rather than as nothing — an absent
 * bar reads as missing data, a stub reads as a day on which nothing happened.
 */
export function Rhythm({
  days,
  target,
  height = 96,
}: {
  days: Array<{ date: string; value: number }>;
  /** Draws the reference line. Omitted when there is no honest target to draw. */
  target?: number;
  height?: number;
}) {
  if (days.length === 0) return <Nothing height={height}>No days to show</Nothing>;

  const W = 460;
  const H = height;
  const foot = 14;
  const peak = Math.max(...days.map((d) => d.value), target ?? 0) || 1;
  const gap = 5;
  const w = (W - gap * (days.length - 1)) / days.length;
  const scale = (v: number) => (v / peak) * (H - foot - 12);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="viz" role="img" aria-label={`${days.length} days`}>
      {target !== undefined && (
        <line
          x1="0"
          x2={W}
          y1={H - foot - scale(target)}
          y2={H - foot - scale(target)}
          stroke="var(--border-strong)"
          strokeDasharray="3 4"
        />
      )}
      {days.map((d, i) => {
        const h = Math.max(scale(d.value), 6);
        const x = i * (w + gap);
        return (
          <rect
            key={d.date}
            x={x}
            y={H - foot - h}
            width={w}
            height={h}
            rx={Math.min(w, h) / 2}
            fill={d.value > 0 ? 'var(--accent)' : 'var(--surface-sunken)'}
          />
        );
      })}
    </svg>
  );
}

/**
 * A fraction of a target, as a bar.
 *
 * `of` is optional on purpose. A bar with no denominator is a bar with no meaning, and the
 * honest response to not having one is to render the amount without a track — never to
 * invent a plausible target, which produces a bar that looks authoritative and is fiction.
 */
export function Meter({
  value,
  of,
  tone = 'var(--accent)',
}: {
  value: number;
  of?: number;
  tone?: string;
}) {
  if (of === undefined || of <= 0) return null;
  const pct = Math.max(0, Math.min(100, (value / of) * 100));
  return (
    <div className="viz-meter" role="img" aria-label={`${Math.round(pct)}%`}>
      <span style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

/**
 * A total, split by category, as one bar.
 *
 * What a donut is for when the categories are ordered — done, doing, waiting — and the
 * reading is "how far along", not "what is the mix".
 */
export function Split({ slices }: { slices: Slice[] }) {
  const sum = slices.reduce((n, s) => n + s.value, 0);
  if (sum === 0) return null;
  return (
    <div className="viz-split" role="img" aria-label={slices.map((s) => `${s.label} ${s.value}`).join(', ')}>
      {slices
        .filter((s) => s.value > 0)
        .map((s) => (
          <span key={s.label} style={{ flex: s.value, background: s.tone }} />
        ))}
    </div>
  );
}

/**
 * The words for a Donut or a Split, laid out so the colour and the count meet the eye together.
 *
 * `format` exists because a slice's value has to stay a number — Donut and Split divide by it —
 * while the legend beside them often wants it as money or hours. The alternative was casting a
 * formatted string back through the Slice type, which type-checks and is a lie.
 */
export function Legend({
  slices,
  format = (n) => String(n),
}: {
  slices: Slice[];
  format?: (value: number) => string;
}) {
  return (
    <ul className="viz-legend">
      {slices.map((s) => (
        <li key={s.label}>
          <i style={{ background: s.tone }} aria-hidden="true" />
          {s.label}
          <b>{format(s.value)}</b>
        </li>
      ))}
    </ul>
  );
}

/**
 * Two numbers per item, plotted against each other.
 *
 * The shape a distribution needs and a bar chart cannot give: fifteen finished cards averaging
 * four days can be fifteen four-day cards or thirteen one-day cards and two three-week ones,
 * and only one of those is a problem. A median hides the difference; dots do not.
 */
export function Scatter({
  points,
  height = 132,
  band,
  yLabel,
}: {
  points: Array<{ x: number; y: number; label: string }>;
  height?: number;
  /** A reference line — a target, a percentile — drawn behind the dots. */
  band?: { value: number; label: string };
  yLabel?: (v: number) => string;
}) {
  if (points.length === 0) return <Nothing height={height}>Nothing finished yet</Nothing>;

  const W = 460;
  const pad = { l: 34, r: 6, t: 10, b: 18 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  // The y axis starts at zero. A duration axis that starts at the smallest value makes the
  // quickest card look like it took no time, which is the wrong shape for the eye to learn.
  const y1 = Math.max(...ys, band?.value ?? 0) || 1;
  const px = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const py = (v: number) => height - pad.b - (v / y1) * (height - pad.t - pad.b);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="viz" role="img" aria-label={`${points.length} items`}>
      <line x1={pad.l} x2={W - pad.r} y1={height - pad.b} y2={height - pad.b} stroke="var(--border)" />
      {band && (
        <>
          <line
            x1={pad.l}
            x2={W - pad.r}
            y1={py(band.value)}
            y2={py(band.value)}
            stroke="var(--warning)"
            strokeDasharray="4 4"
          />
          <text x={W - pad.r} y={py(band.value) - 4} textAnchor="end" className="viz-caption">
            {band.label}
          </text>
        </>
      )}
      {yLabel && (
        <text x="0" y={pad.t + 4} className="viz-caption">
          {yLabel(y1)}
        </text>
      )}
      {points.map((p, i) => (
        <circle
          key={`${p.label}-${i}`}
          cx={px(p.x)}
          cy={py(p.y)}
          r="4.5"
          fill={band && p.y > band.value ? 'var(--warning)' : 'var(--accent)'}
          fillOpacity="0.85"
        >
          <title>{`${p.label} — ${yLabel ? yLabel(p.y) : p.y}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/**
 * One value, against a target, on a scale.
 *
 * A bar chart answers "how much"; this answers "how much, and is that a lot" — which is the
 * question anybody has about a budget. The target is a tick rather than a second bar, so the
 * comparison reads as one thing measured rather than two things competing.
 */
export function Bullet({
  rows,
  format,
  missing = 'no budget set',
}: {
  rows: Array<{ label: string; value: number; of: number | null; note?: string }>;
  format: (n: number) => string;
  /**
   * What to say where there is no denominator.
   *
   * A caller's word, because the reason differs: a project has no *budget*, a person has no
   * *contracted hours*, and telling somebody their colleague has "no budget set" is a sentence
   * about the wrong thing.
   */
  missing?: string;
}) {
  if (rows.length === 0) return <Nothing height={80}>Nothing to measure</Nothing>;
  return (
    <ul className="viz-bullets">
      {rows.map((r) => {
        // No denominator, no bar. A budget nobody entered is not a budget of zero, and a bar
        // against an invented target looks authoritative and is fiction.
        const pct = r.of && r.of > 0 ? Math.min(100, (r.value / r.of) * 100) : null;
        const over = r.of !== null && r.of > 0 && r.value > r.of;
        return (
          <li key={r.label}>
            <span className="viz-bullet-label">{r.label}</span>
            <span className="viz-bullet-track">
              {pct === null ? (
                <em>{missing}</em>
              ) : (
                <i style={{ width: `${pct}%`, background: over ? 'var(--danger)' : 'var(--accent)' }} />
              )}
            </span>
            <span className="viz-bullet-value" data-over={over || undefined}>
              {format(r.value)}
              {r.of ? <small> / {format(r.of)}</small> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Amounts sorted into named bins.
 *
 * What receivables want and a total cannot say: €4.180 outstanding is a different business
 * depending on whether it is all thirty days old or all a hundred, and the bins are how that
 * difference becomes visible without reading a table.
 */
export function Buckets({
  bins,
  format,
}: {
  bins: Array<{ label: string; value: number; tone: string }>;
  format: (n: number) => string;
}) {
  const peak = Math.max(...bins.map((b) => b.value), 1);
  return (
    <ul className="viz-buckets">
      {bins.map((b) => (
        <li key={b.label}>
          <span className="viz-bucket-bar">
            <i style={{ height: `${Math.max(3, (b.value / peak) * 100)}%`, background: b.tone }} />
          </span>
          <b>{format(b.value)}</b>
          <span>{b.label}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A grid of days, coloured by how much.
 *
 * Reads at a glance in a way a line cannot: the pattern people actually have is weekly, and a
 * calendar shape puts every Monday in the same column so a habit shows up as a stripe.
 */
export function Heatmap({
  cells,
  weeks = 6,
  format,
}: {
  cells: Array<{ date: string; value: number }>;
  weeks?: number;
  format: (n: number) => string;
}) {
  if (cells.length === 0) return <Nothing height={90}>No days to show</Nothing>;
  const peak = Math.max(...cells.map((c) => c.value), 1);
  return (
    <div className="viz-heatmap" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }}>
      {cells.map((c) => (
        <span
          key={c.date}
          title={`${c.date} — ${format(c.value)}`}
          data-empty={c.value === 0 || undefined}
          style={{
            // Opacity rather than a colour ramp: one hue with varying weight stays readable to
            // anybody who cannot separate two hues, and needs no legend to decode.
            background: c.value === 0 ? 'var(--surface-sunken)' : 'var(--accent)',
            opacity: c.value === 0 ? 1 : 0.25 + 0.75 * (c.value / peak),
          }}
        />
      ))}
    </div>
  );
}

/**
 * Stages that narrow, with what falls out between them.
 *
 * A funnel and not a bar chart, because the reading is the *drop*: the number that matters is
 * how much of what was sent came back signed, and stacking the stages side by side makes that
 * a subtraction the reader has to do.
 */
export function Funnel({
  stages,
  format,
}: {
  stages: Array<{ label: string; value: number; count: number }>;
  format: (n: number) => string;
}) {
  const top = Math.max(...stages.map((s) => s.value), 1);
  return (
    <ul className="viz-funnel">
      {stages.map((s, i) => (
        <li key={s.label}>
          <span className="viz-funnel-bar" style={{ width: `${Math.max(6, (s.value / top) * 100)}%` }}>
            <b>{format(s.value)}</b>
          </span>
          <span className="viz-funnel-label">
            {s.label}
            <small>
              {s.count} {s.count === 1 ? 'quote' : 'quotes'}
              {i > 0 && stages[i - 1] && stages[i - 1]!.value > 0 && (
                <> · {Math.round((s.value / stages[i - 1]!.value) * 100)}% of above</>
              )}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Dated things along a horizontal run of time.
 *
 * For questions of the form "what is coming and how much room is there before it". A list
 * sorted by date answers the first half; only a scale answers the second, because "three
 * things next month" and "three things on the same Tuesday" are different problems.
 */
export function Timeline({
  events,
  days = 60,
}: {
  events: Array<{ date: string; label: string; tone?: string }>;
  days?: number;
}) {
  if (events.length === 0) return <Nothing height={72}>Nothing scheduled</Nothing>;
  const now = Date.now();
  const span = days * 86_400_000;
  return (
    <div className="viz-timeline">
      <div className="viz-timeline-track">
        {events.map((e) => {
          const at = Math.max(0, Math.min(1, (new Date(e.date).getTime() - now) / span));
          return (
            <span
              key={`${e.date}-${e.label}`}
              className="viz-timeline-pin"
              style={{ left: `${at * 100}%`, background: e.tone ?? 'var(--accent)' }}
              title={`${e.label} — ${e.date}`}
            />
          );
        })}
      </div>
      <div className="viz-timeline-axis">
        <span>today</span>
        <span>{Math.round(days / 2)}d</span>
        <span>{days}d</span>
      </div>
    </div>
  );
}
