'use client';

export function ExportButton() {
  async function exportOrders() {
    const { downloadCsv } = await import('@/lib/csv');
    downloadCsv();
  }
  return <button onClick={exportOrders}>Export orders</button>;
}
