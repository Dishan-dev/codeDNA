'use client';
import Link from 'next/link';
import { toggleFavorite } from '@/lib/favorites';

const rooms = [{ id: 'r1', name: 'Harbour' }];

export function RoomList() {
  return (
    <ul>
      {rooms.map((room) => (
        <li key={room.id}>
          <Link href={`/book/${room.id}`}>{room.name}</Link>
          <button onClick={() => toggleFavorite(room.id)}>Save favorite</button>
        </li>
      ))}
    </ul>
  );
}
