import { prisma } from '@/lib/db';

export default async function BookingsPage() {
  const bookings = await prisma.booking.findMany();
  return <p>{bookings.length} bookings</p>;
}
