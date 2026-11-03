'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';
import { BookingSchema } from './schema';
import { quotePrice } from '@/lib/pricing';
import { getPaymentGateway } from '@/lib/payments';

export async function createBooking(_previous: unknown, formData: FormData) {
  const parsed = BookingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }
  const session = (await cookies()).get('session');
  if (!session) redirect('/login');
  const price = quotePrice(parsed.data.nights, parsed.data.code);
  const receipt = await getPaymentGateway().charge(price);
  const booking = await prisma.booking.create({
    data: { nights: parsed.data.nights, price, receipt: receipt.id },
  });
  revalidatePath('/bookings');
  redirect(`/bookings/${booking.id}`);
}
