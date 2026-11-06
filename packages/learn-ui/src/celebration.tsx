import { Icon } from './icons.js';

const DOTS = [
  { x: -46, y: -30, color: '#6366f1' },
  { x: 40, y: -36, color: '#22c55e' },
  { x: -30, y: 34, color: '#f97316' },
  { x: 48, y: 22, color: '#ec4899' },
  { x: 0, y: -48, color: '#eab308' },
  { x: -54, y: 6, color: '#06b6d4' },
];

/** A small success burst. With reduced motion the dots stay hidden and only the text shows. */
export function Celebration({ xp, text }: { xp?: number; text: string }) {
  return (
    <div className="animate-pop relative flex items-center gap-3" role="status">
      <span className="relative grid h-10 w-10 place-items-center rounded-full bg-success text-surface">
        <Icon name="done" className="h-6 w-6" />
        {DOTS.map((dot) => (
          <span
            key={`${dot.x}:${dot.y}`}
            aria-hidden="true"
            className="codedna-burst absolute h-2 w-2 rounded-full motion-reduce:hidden"
            style={{ backgroundColor: dot.color, ['--burst-x' as string]: `${dot.x}px`, ['--burst-y' as string]: `${dot.y}px` }}
          />
        ))}
      </span>
      <span className="font-semibold text-success">{text}</span>
      {xp ? <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold text-accent">+{xp} XP</span> : null}
    </div>
  );
}
