import type { ChoiceOption } from '@codedna/shared';
import { Icon } from './icons.js';

/**
 * Single-choice options as a radio group of real buttons, numbered so keys 1–9 can pick them. After checking, the right option is
 * marked "Correct" and a wrong pick "Your answer" — with words and icons, not colour alone.
 */
export function ChoiceList({
  options,
  selected,
  onSelect,
  revealed,
  answerId,
  label,
  mono,
}: {
  options: readonly ChoiceOption[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  revealed: boolean;
  answerId: string;
  label: string;
  mono?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2">
      {options.map((option, index) => {
        const checked = selected === option.id;
        const isAnswer = option.id === answerId;
        const state = revealed && isAnswer ? 'right' : revealed && checked ? 'wrong' : checked ? 'selected' : 'idle';
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={revealed}
            onClick={() => onSelect(option.id)}
            className={[
              'flex min-h-[52px] w-full items-center gap-3 rounded-xl border px-4 py-3.5 text-left shadow-card transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default',
              state === 'right' ? 'border-success bg-success-soft ring-1 ring-success' : state === 'wrong' ? 'border-danger bg-danger-soft ring-1 ring-danger' : state === 'selected' ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-line bg-surface hover:border-accent/50 hover:bg-surface-2/50',
            ].join(' ')}
          >
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border text-xs font-semibold tabular-nums transition-colors ${state === 'right' ? 'border-success bg-success text-surface' : state === 'wrong' ? 'border-danger bg-danger text-surface' : checked ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface-2 text-muted'}`}
              aria-hidden="true"
            >
              {state === 'right' ? <Icon name="done" className="h-4 w-4" /> : state === 'wrong' ? '✕' : index + 1}
            </span>
            <span className={`flex-1 text-ink ${mono ? 'whitespace-pre-wrap break-words font-mono text-[13px]' : 'text-[15px]'}`}>{option.label}</span>
            {state === 'right' ? <span className="shrink-0 text-sm font-medium text-success">Correct</span> : null}
            {state === 'wrong' ? <span className="shrink-0 text-sm font-medium text-danger">Your answer</span> : null}
          </button>
        );
      })}
    </div>
  );
}
