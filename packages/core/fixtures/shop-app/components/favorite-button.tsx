'use client';
import { toggleFavorite } from '@/app/actions/favorites';

export function FavoriteButton({ productId }: { productId: string }) {
  return (
    <button onClick={() => toggleFavorite(productId)} aria-label="Save to favorites">
      Save
    </button>
  );
}
