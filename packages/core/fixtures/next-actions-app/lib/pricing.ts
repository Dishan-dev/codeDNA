const PROMOS: Record<string, number> = { SPRING: 0.1 };

export function quotePrice(nights: number, code?: string) {
  const base = nights * 120;
  const discount = code ? base * (PROMOS[code] ?? 0) : 0;
  return Math.max(0, base - discount);
}

export function flatPrice() {
  return 99;
}
