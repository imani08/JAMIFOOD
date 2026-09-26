import { Prisma } from '@jami/database';
import { localDate } from '@jami/shared';
import { PrismaService } from './prisma.service';

export type AutomaticSubscriptionStatus =
  | 'PENDING_PAYMENT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'EXPIRED';

export function subscriptionLifecycleStatus(
  balance: Prisma.Decimal,
  startsOn: Date,
  endsOn: Date,
  today = localDate(),
): AutomaticSubscriptionStatus {
  const start =
    startsOn.toISOString().slice(0, 10);

  const end =
    endsOn.toISOString().slice(0, 10);

  /*
   * Le statut temporel et le solde
   * financier sont distincts.
   *
   * Une dette peut donc continuer
   * d'exister sur un abonnement
   * EXPIRED.
   */
  if (end < today) {
    return 'EXPIRED';
  }

  if (balance.gt(0)) {
    return 'PENDING_PAYMENT';
  }

  if (start > today) {
    return 'SCHEDULED';
  }

  return 'ACTIVE';
}

export async function syncSubscriptionStatuses(
  db: PrismaService,
) {
  const subscriptions =
    await db.subscription.findMany({
      where: {
        status: {
          in: [
            'PENDING_PAYMENT',
            'SCHEDULED',
            'ACTIVE',
          ],
        },
      },

      select: {
        id: true,
        status: true,
        startsOn: true,
        endsOn: true,
        balance: true,
      },
    });

  if (!subscriptions.length) {
    return;
  }

  await db.$transaction(
    async (tx) => {
      for (
        const subscription
        of subscriptions
      ) {
        const nextStatus =
          subscriptionLifecycleStatus(
            subscription.balance,
            subscription.startsOn,
            subscription.endsOn,
          );

        if (
          nextStatus ===
          subscription.status
        ) {
          continue;
        }

        /*
         * updateMany avec ancien
         * statut évite les doubles
         * transitions concurrentes.
         */
        const changed =
          await tx.subscription.updateMany(
            {
              where: {
                id:
                  subscription.id,

                status:
                  subscription.status,
              },

              data: {
                status:
                  nextStatus,
              },
            },
          );

        if (
          changed.count === 1
        ) {
          await tx.auditLog.create({
            data: {
              actorId: null,

              action:
                'SUBSCRIPTION_STATUS_AUTO_CHANGED',

              entityType:
                'Subscription',

              entityId:
                subscription.id,

              oldValue: {
                status:
                  subscription.status,
              },

              newValue: {
                status:
                  nextStatus,
              },
            },
          });
        }
      }
    },
  );
}