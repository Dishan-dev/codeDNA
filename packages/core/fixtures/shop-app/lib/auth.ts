import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';

export async function getSession() {
  const token = (await cookies()).get('session')?.value;
  if (!token) return null;
  return prisma.session.findUnique({ where: { token } });
}
