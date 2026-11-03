'use client';
import { useState } from 'react';
import { track } from '@/analytics/client';

export function SearchBox() {
  const [query, setQuery] = useState('');
  function submitSearch() {
    track('search', query);
  }
  return (
    <form onSubmit={submitSearch}>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="submit">Search</button>
    </form>
  );
}
