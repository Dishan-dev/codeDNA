'use client';
import { useEffect, useMemo, useRef } from 'react';
import type { Feature, Step } from '@codedna/shared';
import { conditionText } from '../story.js';
import { flowLayout } from './layout.js';

const NODE_W = 220;
const NODE_H = 40;
const COL_W = 252;
const ROW_H = 64;
const PAD = 16;

/** Whole class names, so Tailwind keeps them. */
const ARROW_FILL = { accent: 'fill-accent', muted: 'fill-muted', danger: 'fill-danger', line: 'fill-line' } as const;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Every step of the feature as a flowchart: the usual path on the left, other answers to the
 * right, each fork splitting into its answers. The steps of the current playthrough are lit,
 * the current one is filled, and a dot travels along the edge into it. Clicking any box jumps
 * there, choosing the answers that lead to it.
 */
export function Flowchart({ feature, visible, current, onSelect, reduced }: { feature: Feature; visible: readonly Step[]; current: Step; onSelect: (step: Step) => void; reduced: boolean }) {
  const layout = useMemo(() => flowLayout(feature), [feature]);
  const byId = useMemo(() => new Map(layout.nodes.map((node) => [node.step.id, node])), [layout]);
  const onPath = new Set(visible.map((step) => step.id));
  const reached = new Set(visible.slice(0, visible.findIndex((step) => step.id === current.id) + 1).map((step) => step.id));
  const width = PAD * 2 + (layout.columns - 1) * COL_W + NODE_W;
  const height = PAD * 2 + layout.nodes.length * ROW_H - (ROW_H - NODE_H);
  const left = (col: number) => PAD + col * COL_W;
  const top = (row: number) => PAD + row * ROW_H;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = box.current;
    const node = byId.get(current.id);
    if (!container || !node) return;
    const y = top(node.row);
    if (y < container.scrollTop || y + NODE_H > container.scrollTop + container.clientHeight) container.scrollTo({ top: Math.max(0, y - container.clientHeight / 2), behavior: reduced ? 'auto' : 'smooth' });
  }, [current.id, byId, reduced]);

  return (
    <div ref={box} tabIndex={0} role="region" aria-label="Flowchart, scrollable" className="max-h-[380px] overflow-auto rounded-xl border border-line bg-surface outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block min-w-full select-none text-[12px]" aria-hidden="true">
        <defs>
          {(['accent', 'line'] as const).map((tone) => (
            // Arrowheads don't take the line's colour, so each colour has its own.
            <marker key={tone} id={'flow-arrow-' + tone} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto">
              <path d="M0 0L10 5L0 10z" className={ARROW_FILL[tone]} />
            </marker>
          ))}
        </defs>
        {layout.edges.map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          const sx = left(from.col) + NODE_W / 2;
          const sy = top(from.row) + NODE_H;
          const tx = left(to.col) + NODE_W / 2;
          const ty = top(to.row);
          const mid = sy + 12;
          const d = sx === tx ? `M${sx} ${sy} V${ty - 2}` : `M${sx} ${sy} V${mid} H${tx} V${ty - 2}`;
          const lit = reached.has(edge.from) && reached.has(edge.to);
          const into = edge.to === current.id && lit;
          return (
            <g key={`${edge.from}>${edge.to}`} className={lit ? 'text-accent' : 'text-line'}>
              <path d={d} fill="none" stroke="currentColor" strokeWidth={lit ? 2 : 1.5} markerEnd={'url(#flow-arrow-' + (lit ? 'accent' : 'line') + ')'} />
              {edge.label ? (
                <text x={sx === tx ? sx + 8 : tx + (tx > sx ? -8 : 8)} y={sx === tx ? sy + 30 : mid - 5} textAnchor={sx === tx || tx < sx ? 'start' : 'end'} className={`text-[11px] font-semibold ${lit ? 'fill-accent' : 'fill-muted'}`}>
                  {edge.label}
                </text>
              ) : null}
              {into && !reduced ? (
                <circle key={`dot-${current.id}`} r={4.5} className="fill-accent">
                  <animateMotion dur="0.6s" fill="freeze" path={d} />
                </circle>
              ) : null}
            </g>
          );
        })}
        {layout.nodes.map((node) => {
          const now = node.step.id === current.id;
          const done = reached.has(node.step.id) && !now;
          const off = !onPath.has(node.step.id);
          const unknown = node.step.confidence === 'gap';
          const x = left(node.col);
          const y = top(node.row);
          const text = node.branch ? `${conditionText(node.branch)} ?` : node.step.title;
          return (
            <g key={node.step.id} onClick={() => onSelect(node.step)} className={`cursor-pointer ${off ? 'opacity-50' : ''}`}>
              <title>{node.step.title}</title>
              <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={node.branch ? 4 : 10}
                className={now ? 'fill-accent stroke-accent' : unknown ? 'fill-danger-soft stroke-danger' : done ? 'fill-accent-soft stroke-accent' : 'fill-surface stroke-line'}
                strokeWidth={now ? 2 : 1.5}
                strokeDasharray={unknown ? '5 3' : undefined}
              />
              {node.branch ? <path d={`M${x + 16} ${y + NODE_H / 2 - 7}l7 7-7 7-7-7z`} className={now ? 'fill-on-accent' : 'fill-warning'} /> : null}
              <text x={x + (node.branch ? 30 : 12)} y={y + NODE_H / 2 + 4} className={`${now ? 'fill-on-accent font-semibold' : unknown ? 'fill-danger' : 'fill-ink'} ${node.branch ? 'font-mono text-[11px]' : ''}`}>
                {clip(unknown ? `? ${text}` : text, node.branch ? 26 : 30)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
