/**
 * Kleine Verlaufsdiagramme (eine Datenreihe, daher ohne Legende – der Kartentitel benennt sie).
 * Schmale Marken, gedämpfte Hilfslinien, Werte als Tooltip je Marke; die Liste darunter ist die Tabellenansicht.
 */

export interface BarPoint {
  /** Kurzbeschriftung unter der Achse (nur erste und letzte werden gezeigt). */
  label: string;
  /** 0..1 */
  value: number;
  /** Text für Tooltip und Screenreader. */
  title: string;
}

const H = 64;

/** Säulen 0–100 % (z. B. Anwesenheit je Dienst), älteste links. */
export function MiniBars({ points, summary }: { points: BarPoint[]; summary: string }) {
  if (!points.length) return null;
  const n = points.length;
  const gap = 2;
  const w = 100 / n;
  return (
    <figure className="chart">
      <svg className="chart__svg" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" role="img" aria-label={summary}>
        <line className="chart__grid" x1="0" x2="100" y1={H / 2} y2={H / 2} vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const h = Math.max(2, p.value * (H - 2));
          return (
            <g key={i} className="chart__mark">
              <title>{p.title}</title>
              {/* unsichtbare, volle Höhe: großzügige Trefferfläche für den Tooltip */}
              <rect x={i * w} y={0} width={w} height={H} fill="transparent" />
              <rect className="chart__bar" x={i * w + gap / 2} y={H - h} width={Math.max(0.5, w - gap)} height={h} rx="1.2" />
            </g>
          );
        })}
      </svg>
      <figcaption className="chart__axis">
        <span>{points[0]!.label}</span>
        <span>{points[n - 1]!.label}</span>
      </figcaption>
    </figure>
  );
}

export interface LinePoint {
  label: string;
  value: number;
  title: string;
}

/** Linie mit Punkten (z. B. Laufzeiten), älteste links. Der kleinste Wert wird direkt beschriftet. */
export function MiniLine({ points, summary, format }: { points: LinePoint[]; summary: string; format: (v: number) => string }) {
  if (points.length < 2) return null;
  const n = points.length;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 300;
  const pad = 10;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (n - 1);
  const y = (v: number) => pad + ((v - min) / span) * (H - 2 * pad);
  const best = values.indexOf(min);
  return (
    <figure className="chart">
      <svg className="chart__svg chart__svg--line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <line className="chart__grid" x1="0" x2={W} y1={y(min)} y2={y(min)} />
        <line className="chart__grid" x1="0" x2={W} y1={y(max)} y2={y(max)} />
        <polyline className="chart__line" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
        {points.map((p, i) => (
          <g key={i} className="chart__mark">
            <title>{p.title}</title>
            <circle cx={x(i)} cy={y(p.value)} r="12" fill="transparent" />
            <circle className={`chart__dot${i === best ? ' chart__dot--best' : ''}`} cx={x(i)} cy={y(p.value)} r="4" />
          </g>
        ))}
      </svg>
      <figcaption className="chart__axis">
        <span>{points[0]!.label}</span>
        <span className="chart__note">Bestzeit {format(min)} · langsamste {format(max)}</span>
        <span>{points[n - 1]!.label}</span>
      </figcaption>
    </figure>
  );
}
