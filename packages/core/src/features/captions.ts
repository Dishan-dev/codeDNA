/** Deterministic, beginner-friendly text. Every caption comes from a template, never from AI. */

export const short = (text: string, max = 60) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
export const code = (text: string, max = 60) => `\`${short(text, max)}\``;

/** `handleApplyCoupon` → "Apply coupon"; `createBooking` → "Create booking". */
export function humanize(name: string): string {
  const stripped = name.replace(/^(?:handle|on)(?=[A-Z])/, '');
  const words = stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

const EVENT_VERB: Record<string, string> = {
  onClick: 'click',
  onDoubleClick: 'double-click',
  onSubmit: 'submit',
  onChange: 'change',
  onInput: 'type into',
  onKeyDown: 'press a key in',
  onKeyUp: 'release a key in',
  onBlur: 'leave',
  onFocus: 'focus',
  onSelect: 'select',
};
export const EVENT_ATTRIBUTES = new Set(Object.keys(EVENT_VERB));

export function triggerCaption(event: string, element: string, label: string | undefined): { title: string; plain: string } {
  const quoted = label ? `“${short(label, 40)}”` : undefined;
  if (event === 'action' || event === 'formAction' || event === 'onSubmit')
    return { title: quoted ? `You press ${quoted}` : 'You submit the form', plain: quoted ? `You fill in the form and press ${quoted}.` : 'You fill in the form and send it.' };
  if (event === 'onChange' || event === 'onInput')
    return { title: quoted ? `You type in ${quoted}` : 'You type in a field', plain: quoted ? `You type in the ${quoted} field. This runs on every change.` : 'You type in a field. This runs on every change.' };
  const verb = EVENT_VERB[event] ?? 'use';
  const thing = element === 'a' || element === 'Link' ? 'link' : element === 'button' || /button/i.test(element) ? 'button' : 'element';
  return { title: quoted ? `You ${verb} ${quoted}` : `You ${verb} the ${thing}`, plain: quoted ? `You ${verb} the ${quoted} ${thing}.` : `You ${verb} the ${thing}.` };
}

/** FNV-1a, 32-bit: small, stable and runtime-independent. Not for security. */
export function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}
