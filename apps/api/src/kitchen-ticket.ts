import { Prisma } from '@jami/database';
import type { Tx } from './transaction';

type OrderForKitchen = {
  id: string;
  number: string;
  serviceMode: string;
  items: Array<{
    quantity: Prisma.Decimal;
    productSnapshot: Prisma.JsonValue;
    variantsSnapshot: Prisma.JsonValue | null;
    supplementsSnapshot: Prisma.JsonValue | null;
  }>;
};

export async function confirmOrderAndIssueKitchenTicket(tx: Tx, order: OrderForKitchen, actorId: string | null) {
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'CONFIRMED',
      statusHistory: { create: { fromStatus: 'RECEIVED', toStatus: 'CONFIRMED', actorId } },
      kitchenTicket: {
        create: {
          number: `K-${order.number}`,
          renderedSnapshot: { orderNumber: order.number, paymentStatus: 'CONFIRMED', serviceMode: order.serviceMode },
          items: {
            create: order.items.map(item => ({
              quantity: item.quantity,
              preparationSnapshot: {
                name: (item.productSnapshot as { name?: string }).name ?? 'Article',
                variants: item.variantsSnapshot,
                supplements: item.supplementsSnapshot,
              },
            })),
          },
        },
      },
    },
  });
}
