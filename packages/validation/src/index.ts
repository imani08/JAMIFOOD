import { z } from 'zod';
export const uuid = z.string().uuid();
export const money = z.union([z.string().regex(/^\d{1,12}(\.\d{1,2})?$/), z.number().finite().nonnegative().max(999999999999).multipleOf(0.01)]).transform(String);
export const currency = z.enum(['USD', 'CDF']);
export const createClientSchema = z.object({ firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100), categoryId: uuid, ulcNumber: z.string().trim().max(50).optional(), faculty: z.string().max(100).optional(), promotion: z.string().max(100).optional(), residency: z.string().max(100).optional(), phone: z.string().trim().max(40).optional(), email: z.string().email().optional() }).strict();
export const consumeMealSchema = z.object({ mealRightId: uuid, serviceCode: z.enum(['BREAKFAST', 'LUNCH', 'DINNER']) }).strict();
export const createOrderSchema = z
  .object({
    clientId: uuid.optional(),

    categoryCode: z
      .string()
      .min(1)
      .max(50),

    serviceMode: z.enum([
      'DINE_IN',
      'TAKEAWAY',
      'DELIVERY',
    ]),

    currency,

    items: z
      .array(
        z
          .object({
            productId: uuid,

            quantity: z
              .number()
              .int()
              .min(1)
              .max(100),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const confirmPaymentSchema = z.object({ cashSessionId: uuid, method: z.enum(['CASH', 'MPESA', 'ORANGE_MONEY', 'AIRTEL_MONEY', 'CARD', 'TRANSFER']), receivedAmount: money, receivedCurrency: currency, externalReference: z.string().trim().min(1).max(120).optional() }).strict().refine(v => v.method === 'CASH' || !!v.externalReference, { message: 'Référence externe obligatoire', path: ['externalReference'] });
export const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25), q: z.string().max(100).optional() });
