'use client';
import { useActionState, useState } from 'react';
import Link from 'next/link';
import { createBooking } from '@/lib/bookings/actions';

export function BookingForm() {
  const [state, formAction] = useActionState(createBooking, null);
  const [discount, setDiscount] = useState(0);
  const [code, setCode] = useState('');

  async function applyPromo() {
    const response = await fetch(`/api/promos/${code}`);
    const body = await response.json();
    setDiscount(body.discounted);
  }

  return (
    <form action={formAction}>
      <input name="nights" />
      <input value={code} onChange={(event) => setCode(event.target.value)} />
      <button type="button" onClick={applyPromo}>Apply promo</button>
      <p>{state?.errors ? 'Please check the form' : discount}</p>
      <button type="submit">Reserve room</button>
      <Link href="/rooms">Back to rooms</Link>
    </form>
  );
}
