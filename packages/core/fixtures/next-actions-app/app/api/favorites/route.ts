import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  const { roomId } = await request.json();
  const favorite = await prisma.favorite.create({ data: { roomId } });
  return Response.json(favorite);
}
