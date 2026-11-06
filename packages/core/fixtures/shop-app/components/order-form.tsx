'use client';
import { useActionState, useState } from 'react';
import { placeOrder } from '@/app/actions/orders';
import { CartSummary } from './cart-summary';

export function OrderForm({ productId }: { productId: string }) {
  const [state, formAction] = useActionState(placeOrder, null);
  const [code, setCode] = useState('');
  const [discount, setDiscount] = useState(0);

  async function applyCoupon() {
    const response = await fetch('/api/coupons', { method: 'POST', body: JSON.stringify({ code }) });
    const data = await response.json();
    setDiscount(data.discount);
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="productId" value={productId} />
      <input name="quantity" type="number" defaultValue={1} />
      <input placeholder="Coupon code" value={code} onChange={(event) => setCode(event.target.value)} />
      <button type="button" onClick={applyCoupon}>Apply coupon</button>
      {state?.error && <p role="alert">{state.error}</p>}
      <CartSummary cents={1299} discount={discount} />
      <button type="submit">Place order</button>
    </form>
  );
}
