function formatPrice(cents: number) {
  return '$' + (cents / 100).toFixed(2);
}

export function CartSummary({ cents, discount }: { cents: number; discount: number }) {
  const total = cents - (cents * discount) / 100;
  return <p>Total: {formatPrice(total)}</p>;
}
