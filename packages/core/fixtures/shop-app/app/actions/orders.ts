'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { OrderSchema } from '@/lib/validation';
import { notify } from '@/lib/notify';

export async function placeOrder(_previous: unknown, formData: FormData) {
  const session = await getSession();
  if (!session) redirect('/login');

  const parsed = OrderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: 'Please check your order.' };
  }

  const order = await prisma.order.create({
    data: { userId: session.userId, productId: parsed.data.productId, quantity: parsed.data.quantity },
  });
  await notify(`New order ${order.id}`);
  revalidatePath('/orders');
  redirect(`/orders/${order.id}`);
}
