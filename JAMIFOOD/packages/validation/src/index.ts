import { z } from 'zod';
export const uuid = z.string().uuid();
export const money = z.coerce.number().finite().nonnegative().multipleOf(0.01);
export const currency = z.enum(['USD', 'CDF']);
export const createClientSchema = z.object({ firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100), categoryId: uuid, ulcNumber: z.string().trim().max(50).optional(), phone: z.string().trim().max(40).optional(), email: z.string().email().optional() });
export const consumeMealSchema = z.object({ mealRightId: uuid, orderId: uuid.optional() });
export const createOrderSchema = z.object({ clientId: uuid.optional(), serviceMode: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']), currency, items: z.array(z.object({ productId: uuid, quantity: z.coerce.number().positive(), variants: z.record(z.unknown()).optional(), supplements: z.array(z.unknown()).optional() })).min(1) });
export const confirmPaymentSchema = z.object({ method: z.enum(['CASH', 'MPESA', 'ORANGE_MONEY', 'AIRTEL_MONEY', 'CARD', 'TRANSFER']), receivedAmount: money, receivedCurrency: currency, externalReference: z.string().trim().max(120).optional() });
