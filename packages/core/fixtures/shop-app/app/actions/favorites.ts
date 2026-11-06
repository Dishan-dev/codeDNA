'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';

export async function toggleFavorite(productId: string) {
  await prisma.favorite.create({ data: { productId } });
  revalidatePath('/');
}
