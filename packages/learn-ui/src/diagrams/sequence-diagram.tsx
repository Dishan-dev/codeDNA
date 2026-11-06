'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Step } from '@codedna/shared';
import type { Lane, SequenceRow } from './layout.js';

const ROW_H = 60;
const HEAD_H = 60;
const TOP = 8;
const PAD = 16;
/** Column width: fills the box on wide screens, never narrower than a readable minimum. */
const MIN_LANE = 120;
const MAX_LANE = 300;

const LANE_LABEL: Record<Lane, string> = { person: 'You', browser: 'Browser', server: 'Server', database: 'Database', service: 'Other service' };

/** Whole class names, so Tailwind keeps them. */
const ARROW_FILL = { accent: 'fill-accent', muted: 'fill-muted', danger: 'fill-danger' } as const;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

/**
 * A sequence diagram of one playthrough: a column per place, an arrow per step that moves the
 * story, a note for a step that stays put. Rows already played are solid, the current one draws
 * itself, and the rest wait faded so the learner sees the whole conversation ahead. Column names
 * stay pinned while the rows scroll, and the box follows the current step both ways.
 */
export function SequenceDiagram({ lanes, rows, position, personLabel, onSelect, reduced }: { lanes: readonly Lane[]; rows: readonly SequenceRow[]; position: number; personLabel: string; onSelect: (index: number) => void; reduced: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const container = box.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setBoxWidth(container.clientWidth));
    observer.observe(container);
    setBoxWidth(container.clientWidth);
    return () => observer.disconnect();
  }, []);
  const laneW = Math.max(MIN_LANE, Math.min(MAX_LANE, Math.floor((boxWidth - PAD * 2) / Math.max(1, lanes.length)) || MAX_LANE));
  const x = (lane: Lane) => PAD + lanes.indexOf(lane) * laneW + laneW / 2;
  const width = PAD * 2 + lanes.length * laneW;
  const height = TOP + rows.length * ROW_H + PAD;
  // When every column fits, the diagram sits in the middle of the box instead of hugging the left.
  const offset = Math.max(0, Math.floor((boxWidth - width) / 2));

  // Follow the current step: down to its row, and sideways to its columns on narrow screens.
  const current = rows[position];
  useEffect(() => {
    const container = box.current;
    if (!container || !current) return;
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth';
    const top = TOP + position * ROW_H;
    const visible = container.clientHeight - HEAD_H;
    const scrollTop = top < container.scrollTop || top + ROW_H > container.scrollTop + visible ? Math.max(0, top - visible / 2) : container.scrollTop;
    const lanesOf = current.kind === 'arrow' ? [current.from, current.to] : [current.lane];
    const left = offset + Math.min(...lanesOf.map(x)) - laneW / 2;
    const right = offset + Math.max(...lanesOf.map(x)) + laneW / 2 + (current.kind === 'self' ? 160 : 0);
    const scrollLeft = left < container.scrollLeft || right > container.scrollLeft + container.clientWidth ? Math.max(0, left - PAD) : container.scrollLeft;
    container.scrollTo({ top: scrollTop, left: scrollLeft, behavior });
  }, [position, reduced, laneW]);

  const label = (step: Step) => (step.confidence === 'gap' ? `? ${step.title}` : step.title);

  return (
    <div ref={box} tabIndex={0} role="region" aria-label="Sequence diagram, scrollable" className="max-h-[480px] overflow-auto rounded-xl border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent">
      {/* Column names, pinned while the rows scroll */}
      <div className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur" style={{ minWidth: width, height: HEAD_H }} aria-hidden="true">
        {lanes.map((lane) => (
          <span
            key={lane}
            className="absolute top-3 flex h-9 -translate-x-1/2 items-center justify-center truncate rounded-xl border border-line bg-surface-2 px-3 text-[13px] font-semibold text-ink"
            style={{ left: offset + x(lane), width: Math.min(150, laneW - 16) }}
          >
            {lane === 'person' ? personLabel : LANE_LABEL[lane]}
          </span>
        ))}
      </div>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mx-auto block select-none text-[13.5px]" aria-hidden="true">
        <defs>
          {(['accent', 'muted', 'danger'] as const).map((tone) => (
            // Arrowheads don't take the line's colour, so each colour has its own.
            <marker key={tone} id={'seq-arrow-' + tone} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" className={ARROW_FILL[tone]} />
            </marker>
          ))}
        </defs>
        {lanes.map((lane) => (
          <line key={lane} x1={x(lane)} x2={x(lane)} y1={0} y2={height} className="stroke-line" strokeDasharray="4 4" />
        ))}
        {rows.map((row, index) => {
          const y = TOP + index * ROW_H + ROW_H / 2 + 4;
          const state = index < position ? 'done' : index === position ? 'now' : 'next';
          const unknown = row.step.confidence === 'gap';
          const tone = unknown ? 'text-danger' : state === 'next' ? 'text-muted' : 'text-accent';
          return (
            <g key={row.step.id} onClick={() => onSelect(index)} className={`cursor-pointer ${state === 'next' ? 'opacity-40' : ''}`}>
              <title>{`Step ${index + 1}: ${row.step.title}`}</title>
              <rect x={0} y={y - ROW_H / 2 - 4} width={width} height={ROW_H} className={state === 'now' ? 'fill-accent-soft' : 'fill-transparent'} />
              {row.kind === 'arrow' ? (
                (() => {
                  const x1 = x(row.from);
                  const x2 = x(row.to);
                  const length = Math.abs(x2 - x1);
                  const draw = state === 'now' && !reduced && !row.back && !unknown;
                  return (
                    <g className={tone}>
                      <line
                        key={draw ? `draw-${position}` : 'still'}
                        x1={x1}
                        x2={x2}
                        y1={y}
                        y2={y}
                        stroke="currentColor"
                        strokeWidth={state === 'now' ? 2.25 : 1.5}
                        strokeDasharray={row.back || unknown ? '6 4' : draw ? `${length}` : undefined}
                        markerEnd={`url(#seq-arrow-${unknown ? 'danger' : state === 'next' ? 'muted' : 'accent'})`}
                        className={draw ? 'codedna-seq-draw' : undefined}
                        style={draw ? ({ ['--seq-length' as string]: `${length}` } as CSSProperties) : undefined}
                      />
                      {state === 'now' && !reduced ? (
                        <circle key={`dot-${position}`} r={5} cy={y} className="fill-current">
                          <animate attributeName="cx" from={x1} to={x2} dur="0.7s" fill="freeze" />
                        </circle>
                      ) : null}
                      <text x={(x1 + x2) / 2} y={y - 9} textAnchor="middle" className={`fill-current ${state === 'now' ? 'font-semibold' : ''}`} style={{ paintOrder: 'stroke' }} stroke="rgb(var(--color-surface))" strokeWidth={4}>
                        {clip(label(row.step), Math.floor(length / 7.5))}
                      </text>
                    </g>
                  );
                })()
              ) : (
                <g className={tone}>
                  <rect x={x(row.lane) - 7} y={y - 13} width={14} height={26} rx={4} className="fill-surface stroke-current" strokeDasharray={unknown ? '3 2' : undefined} strokeWidth={state === 'now' ? 2 : 1.25} />
                  <text x={x(row.lane) + 15} y={y + 5} className={`fill-current ${state === 'now' ? 'font-semibold' : ''}`} style={{ paintOrder: 'stroke' }} stroke="rgb(var(--color-surface))" strokeWidth={4}>
                    {clip(label(row.step), 44)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
