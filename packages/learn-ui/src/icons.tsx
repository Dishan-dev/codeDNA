import type { IconName } from './meta.js';

/** Simple 24×24 line icons, drawn with the current text colour. Decorative: always paired with text. */
const PATHS: Record<IconName, string[]> = {
  click: ['M9 4v8', 'M9 12l-2.5-2.5', 'M9 12l9 2-4 2 2 4-2 1-2-4-3 3z'],
  form: ['M6 3h9l3 3v15H6z', 'M9 9h6', 'M9 13h6', 'M9 17h4'],
  client: ['M3 5h18v11H3z', 'M8 20h8', 'M12 16v4'],
  request: ['M4 12h13', 'M13 7l5 5-5 5', 'M20 5v14'],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01'],
  check: ['M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  logic: ['M12 8a4 4 0 100 8 4 4 0 000-8z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M5 5l2 2', 'M17 17l2 2', 'M5 19l2-2', 'M17 7l2-2'],
  database: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  external: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M3 12h18', 'M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z'],
  response: ['M20 12H7', 'M11 7l-5 5 5 5', 'M4 5v14'],
  screen: ['M3 4h18v14H3z', 'M3 8h18', 'M7 12h6', 'M7 15h4'],
  unknown: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5', 'M12 17h.01'],
  play: ['M7 4l13 8-13 8z'],
  pause: ['M7 4h3v16H7z', 'M14 4h3v16h-3z'],
  back: ['M15 5l-7 7 7 7'],
  next: ['M9 5l7 7-7 7'],
  replay: ['M4 12a8 8 0 108-8H8', 'M11 1L8 4l3 3'],
  code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M14 4l-4 16'],
  branch: ['M6 3v12', 'M18 9a3 3 0 100-6 3 3 0 000 6z', 'M6 21a3 3 0 100-6 3 3 0 000 6z', 'M18 9c0 6-12 3-12 9'],
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 018 0v4'],
  done: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M8 12l3 3 5-6'],
  star: ['M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z'],
  flame: ['M12 21c4 0 7-2.8 7-6.8 0-4.2-3.4-6.6-5-11.2-1.6 3-3 4-3 6.5-1.5-1-2-2.5-2-4C6 8 5 10.5 5 14.2 5 18.2 8 21 12 21z'],
  lightbulb: ['M9 18h6', 'M10 21h4', 'M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z'],
  terminal: ['M3 4h18v16H3z', 'M7 9l3 3-3 3', 'M12 15h5'],
  github: ['M9 19c-4 1.5-4-2-6-2.5', 'M15 21v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 00-1.3-3.2 4.2 4.2 0 00-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 00-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 00-.1 3.2A4.6 4.6 0 004 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21'],
  book: ['M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z', 'M4 19V5', 'M8 7h7'],
};

export function Icon({ name, className, title }: { name: IconName; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
