import Link from 'next/link';
import { prisma } from '@/lib/db';
import { formatPrice } from '@/lib/format';
import { FavoriteButton } from '@/components/favorite-button';
import { SearchBox } from '@/components/search-box';

export default async function HomePage() {
  const products = await prisma.product.findMany();
  return (
    <main>
      <SearchBox />
      {products.map((product) => (
        <article key={product.id}>
          <h2>{product.name}</h2>
          <p>{formatPrice(product.cents)}</p>
          <FavoriteButton productId={product.id} />
        </article>
      ))}
      <Link href="/checkout">Go to checkout</Link>
    </main>
  );
}
