"use client";

import { useMemo, useState } from "react";

// Palette categorica validata (slot 1-3) — l'ordine è la garanzia di
// distinguibilità anche per chi ha deficit di visione dei colori, quindi va
// assegnata in sequenza fissa, mai ciclata.
export const SERIES_COLORS = {
  delivered: "#2a78d6", // slot 1 blu
  read: "#eb6834", // slot 2 arancio
  clicked: "#1baf7a", // slot 3 acqua
} as const;

export const STATUS_CRITICAL = "#d03b3b";

const AXIS_COLOR = "#d9d8d3";
const TEXT_MUTED = "#767570";

export interface TimePoint {
  date: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

interface SeriesDef {
  key: keyof Omit<TimePoint, "date">;
  label: string;
  color: string;
}

// Grafico a linee con crosshair e tooltip: una serie temporale senza hover
// costringe a leggere i valori "a occhio" dall'asse, che è esattamente ciò
// che rende inutilizzabile una dashboard analitica.
export function TimeSeriesChart({ data, series }: { data: TimePoint[]; series: SeriesDef[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const width = 760;
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 28, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const maxValue = useMemo(() => {
    const values = data.flatMap((d) => series.map((s) => d[s.key]));
    return Math.max(1, ...values);
  }, [data, series]);

  if (data.length === 0) return <EmptyChart />;

  const x = (i: number) => padding.left + (data.length === 1 ? plotWidth / 2 : (i / (data.length - 1)) * plotWidth);
  const y = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;

  const ticks = [0, 0.5, 1].map((f) => Math.round(maxValue * f));
  const labelStep = Math.max(1, Math.ceil(data.length / 7));

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          role="img"
          aria-label="Andamento giornaliero dei messaggi"
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relativeX = ((e.clientX - rect.left) / rect.width) * width;
            const ratio = (relativeX - padding.left) / plotWidth;
            const index = Math.round(ratio * (data.length - 1));
            setHoverIndex(Math.min(data.length - 1, Math.max(0, index)));
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={AXIS_COLOR}
                strokeWidth={1}
              />
              <text x={padding.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill={TEXT_MUTED}>
                {tick}
              </text>
            </g>
          ))}

          {data.map((point, i) =>
            i % labelStep === 0 ? (
              <text
                key={point.date}
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize={11}
                fill={TEXT_MUTED}
              >
                {formatDayLabel(point.date)}
              </text>
            ) : null,
          )}

          {hoverIndex !== null && (
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={padding.top}
              y2={padding.top + plotHeight}
              stroke={AXIS_COLOR}
              strokeWidth={1}
            />
          )}

          {series.map((s) => (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" ")}
            />
          ))}

          {hoverIndex !== null &&
            series.map((s) => (
              <circle
                key={s.key}
                cx={x(hoverIndex)}
                cy={y(data[hoverIndex][s.key])}
                r={4}
                fill={s.color}
                stroke="#ffffff"
                strokeWidth={2}
              />
            ))}
        </svg>

        {hoverIndex !== null && (
          <div
            className="pointer-events-none absolute top-2 rounded border bg-white px-3 py-2 text-xs shadow-sm"
            style={{ left: `${(x(hoverIndex) / width) * 100}%`, transform: "translateX(-50%)" }}
          >
            <div className="mb-1 font-medium">{formatFullDate(data[hoverIndex].date)}</div>
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-gray-600">{s.label}</span>
                <span className="ml-auto font-medium">{data[hoverIndex][s.key]}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export interface FunnelStage {
  label: string;
  value: number;
  color: string;
}

// Imbuto di consegna come barre orizzontali: le percentuali sono sempre
// riferite allo stadio precedente, così è chiaro dove si perdono i messaggi.
export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <figure className="m-0 space-y-2">
      {stages.map((stage, i) => {
        const previous = i === 0 ? stage.value : stages[i - 1].value;
        const share = previous === 0 ? 0 : (stage.value / previous) * 100;
        return (
          <div
            key={stage.label}
            className="relative"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-gray-600">{stage.label}</span>
              <span className="font-medium">
                {stage.value.toLocaleString("it-IT")}
                {i > 0 && <span className="ml-2 text-xs text-gray-500">{share.toFixed(1)}% del passo prima</span>}
              </span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-sm bg-gray-100">
              <div
                className="h-full rounded-sm transition-[width]"
                style={{
                  width: `${(stage.value / max) * 100}%`,
                  background: stage.color,
                  opacity: hovered === null || hovered === i ? 1 : 0.55,
                }}
              />
            </div>
          </div>
        );
      })}
    </figure>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-40 items-center justify-center rounded border border-dashed text-sm text-gray-400">
      Nessun dato nel periodo selezionato
    </div>
  );
}

function formatDayLabel(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function formatFullDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
