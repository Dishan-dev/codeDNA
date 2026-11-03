import { quotePrice } from '@/lib/pricing';

export async function GET(_request: Request, { params }: { params: { code: string } }) {
  const discounted = quotePrice(1, params.code);
  return Response.json({ discounted });
}
