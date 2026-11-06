import type { Step } from '@codedna/shared';
import { Icon } from './icons.js';
import { STAGES, type IconName } from './meta.js';
import { type Place, type Zone } from './story.js';

const ZONES: Record<Zone, { label: string; note: string; icon: IconName }> = {
  browser: { label: 'Browser', note: 'what you see', icon: 'client' },
  server: { label: 'Server', note: 'runs the code', icon: 'server' },
  database: { label: 'Database', note: 'keeps the data', icon: 'database' },
  service: { label: 'Other service', note: 'email, payments…', icon: 'external' },
};

/**
 * Where the story is right now: the places the feature moves between, with a marker that travels
 * from place to place as the steps play. Decorative for screen readers — the caption says the same.
 */
export function JourneyMap({ zones, place, step, visited, reduced }: { zones: readonly Zone[]; place: Place; step: Step; visited: ReadonlySet<Zone>; reduced: boolean }) {
  const center = (zone: Zone) => ((zones.indexOf(zone) + 0.5) / zones.length) * 100;
  const travelling = !('zone' in place);
  const at = 'zone' in place ? center(place.zone) : (center(place.from) + center(place.to)) / 2;
  const active = 'zone' in place ? [place.zone] : [place.from, place.to];
  const unknown = step.confidence === 'gap';
  const first = center(zones[0]!);
  const last = center(zones[zones.length - 1]!);
  const move = reduced ? '' : 'transition-[left] duration-700 ease-in-out';
  return (
    <div className="relative mx-auto h-[176px] max-w-4xl select-none" aria-hidden="true">
      {/* Track */}
      <span className="absolute top-[22px] h-0.5 rounded-full bg-line" style={{ left: `${first}%`, width: `${last - first}%` }} />
      {travelling ? (
        <span
          className={`absolute top-[21px] h-1 rounded-full bg-accent/30 ${reduced ? '' : `codedna-flow${'to' in place && place.to === 'browser' ? ' codedna-flow-back' : ''}`}`}
          style={{ left: `${Math.min(center(place.from), center(place.to))}%`, width: `${Math.abs(center(place.to) - center(place.from))}%` }}
        />
      ) : null}

      {/* The travelling marker */}
      <span data-journey-marker="" className={`absolute top-0 z-10 -translate-x-1/2 ${move}`} style={{ left: `${at}%` }}>
        <span className="relative grid h-11 w-11 place-items-center">
          {reduced ? null : <span className={`absolute inset-0 animate-ping rounded-full ${unknown ? 'bg-danger/25' : 'bg-accent/25'}`} />}
          <span key={step.id} className={`animate-pop relative grid h-11 w-11 place-items-center rounded-full border-2 shadow-lift ${unknown ? 'border-dashed border-danger bg-danger-soft text-danger' : 'border-surface bg-accent text-on-accent'}`}>
            <Icon name={unknown ? 'unknown' : STAGES[step.stage].icon} className="h-5 w-5" />
          </span>
        </span>
        {travelling ? (
          <span className="absolute left-1/2 top-12 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-accent shadow-card">
            {'to' in place && place.to === 'server' ? 'sending →' : '← answer'}
          </span>
        ) : null}
      </span>

      {/* Places */}
      {zones.map((zone) => {
        const on = active.includes(zone) && !travelling;
        const seen = visited.has(zone);
        return (
          <span key={zone} className="absolute top-[70px] flex w-[96px] -translate-x-1/2 flex-col items-center text-center sm:w-[140px]" style={{ left: `${center(zone)}%` }}>
            <span
              className={`grid h-14 w-14 place-items-center rounded-2xl border-2 transition-all duration-300 ${on ? 'scale-110 border-accent bg-accent-soft text-accent shadow-[0_0_0_6px_rgb(var(--color-accent)/0.12)]' : seen ? 'border-accent/40 bg-surface text-accent' : 'border-line bg-surface text-muted'}`}
            >
              <Icon name={ZONES[zone].icon} className="h-7 w-7" />
            </span>
            <span className={`mt-2.5 text-sm leading-tight ${on ? 'font-semibold text-ink' : 'font-medium text-muted'}`}>{ZONES[zone].label}</span>
            <span className="hidden text-xs leading-tight text-muted sm:block">{ZONES[zone].note}</span>
          </span>
        );
      })}
    </div>
  );
}
