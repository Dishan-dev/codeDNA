import Link from 'next/link';
import { SearchBox } from '@/components/search-box';

export const metadata = { title: 'Roomly' };

export default function Home() {
  return (
    <main>
      <h1>Find a room</h1>
      <SearchBox />
      <Link href="/rooms">Browse rooms</Link>
    </main>
  );
}
