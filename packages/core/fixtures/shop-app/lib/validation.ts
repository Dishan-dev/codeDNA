import { z } from 'zod';

export const OrderSchema = z.object({
  productId: z.string(),
  quantity: z.coerce.number().min(1),
});
