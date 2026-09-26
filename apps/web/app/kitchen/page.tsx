'use client';

import {
  Feedback,
  Heading,
  Loading,
  useAction,
  useData,
} from '../../components/common';

import {
  api,
  date,
} from '../../lib/api';

type Order = {
  id: string;
  number: string;
  status: string;
  serviceMode: string;
  createdAt: string;

  kitchenTicket: {
    items: {
      id: string;
      quantity: string;

      preparationSnapshot: {
        name: string;
      };
    }[];
  } | null;
};

export default function Kitchen() {
  const q =
    useData<Order[]>('/kitchen');

  const a = useAction();

  const columns = [
    {
      status: 'CONFIRMED',
      label: 'À préparer',
      next: 'PREPARING',
      action: 'Prendre en charge',
    },
    {
      status: 'PREPARING',
      label: 'En préparation',
      next: 'READY',
      action: 'Terminer',
    },
    {
      status: 'READY',
      label: 'Prêtes',
      next: 'SERVED',
      action: 'Repas remis',
    },
  ] as const;

  return (
    <>
      <Heading
        title="La cuisine"
        subtitle="Préparation et remise des commandes."
      />

      <Feedback {...a} />

      <Loading
        loading={q.isLoading}
        error={q.error}
      />

      <div className="columns">
        {columns.map(
          ({
            status,
            label,
            next,
            action,
          }) => (
            <section
              className="card"
              key={status}
            >
              <h2>
                {label}{' '}
                <span className="badge">
                  {q.data?.filter(
                    (o) =>
                      o.status ===
                      status,
                  ).length ?? 0}
                </span>
              </h2>

              {q.data
                ?.filter(
                  (o) =>
                    o.status ===
                    status,
                )
                .map((o) => (
                  <article
                    className="card ticket"
                    key={o.id}
                  >
                    <h3>
                      {o.number}
                    </h3>

                    <p className="muted small">
                      {date(
                        o.createdAt,
                      )}
                      {' · '}

                      {o.serviceMode ===
                      'DINE_IN'
                        ? 'Sur place'
                        : o.serviceMode ===
                            'TAKEAWAY'
                          ? 'À emporter'
                          : 'Livraison'}
                    </p>

                    {o.kitchenTicket?.items.map(
                      (i) => (
                        <p key={i.id}>
                          {i.quantity}
                          {' × '}
                          {
                            i
                              .preparationSnapshot
                              .name
                          }
                        </p>
                      ),
                    )}

                    {status ===
                      'READY' &&
                    o.serviceMode ===
                      'DELIVERY' ? (
                      <p className="success">
                        Prête pour le
                        livreur.
                      </p>
                    ) : (
                      <button
                        className="primary full"
                        disabled={a.busy}
                        onClick={() =>
                          a.run(
                            async () => {
                              await api(
                                '/kitchen/' +
                                  o.id +
                                  '/status',
                                {
                                  status:
                                    next,
                                },
                              );

                              await q.refetch();
                            },
                          )
                        }
                      >
                        {action}
                      </button>
                    )}
                  </article>
                ))}

              {!q.data?.some(
                (o) =>
                  o.status ===
                  status,
              ) && (
                <p className="empty">
                  Aucune commande.
                </p>
              )}
            </section>
          ),
        )}
      </div>
    </>
  );
}