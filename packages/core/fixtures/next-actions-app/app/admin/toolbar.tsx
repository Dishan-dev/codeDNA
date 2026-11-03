'use client';
import { quotePrice, flatPrice } from '@/lib/pricing';

const strategies = { quote: quotePrice, flat: flatPrice };

export function Toolbar({ endpoint }: { endpoint: string }) {
  async function exportCsv() {
    const csv = await import('./csv');
    csv.download();
  }
  async function importBookings() {
    await fetch(endpoint, { method: 'POST' });
  }
  function runPricing(kind: keyof typeof strategies) {
    strategies[kind](1);
  }
  return (
    <div>
      <button onClick={exportCsv}>Export CSV</button>
      <button onClick={importBookings}>Import bookings</button>
      <button onClick={() => runPricing('quote')}>Run pricing job</button>
    </div>
  );
}
