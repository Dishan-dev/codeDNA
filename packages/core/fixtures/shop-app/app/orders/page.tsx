import { prisma } from '@/lib/db';
import { ExportButton } from '@/components/export-button';

export default async function OrdersPage() {
  const orders = await prisma.order.findMany();
  return (
    <main>
      <ExportButton />
      <ul>
        {orders.map((order) => (
          <li key={order.id}>{order.id}</li>
        ))}
      </ul>
    </main>
  );
}
