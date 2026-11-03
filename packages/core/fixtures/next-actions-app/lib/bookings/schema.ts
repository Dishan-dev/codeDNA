import { z } from 'zod';

export const BookingSchema = z.object({
  nights: z.coerce.number().min(1),
  code: z.string().optional(),
});
