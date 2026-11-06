'use client';
import { useState } from 'react';

export function SearchBox() {
  const [query, setQuery] = useState('');
  return <input placeholder="Search snacks" value={query} onChange={(event) => setQuery(event.target.value)} />;
}
