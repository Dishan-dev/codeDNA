export async function toggleFavorite(roomId: string) {
  const response = await fetch('/api/favorites', {
    method: 'POST',
    body: JSON.stringify({ roomId }),
  });
  return response.ok;
}
