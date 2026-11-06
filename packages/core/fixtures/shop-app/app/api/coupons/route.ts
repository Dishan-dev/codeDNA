import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  const { code } = await request.json();
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon) {
    return Response.json({ discount: 0 }, { status: 404 });
  }
  return Response.json({ discount: coupon.percent });
}
