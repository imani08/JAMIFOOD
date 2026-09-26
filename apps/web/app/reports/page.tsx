'use client';

import {
  FormEvent,
  useState,
} from 'react';

import Link from 'next/link';

import {
  Heading,
  Loading,
  useData,
} from '../../components/common';

import {
  downloadCSV,
  money,
} from '../../lib/api';

type ServiceMode =
  | 'DINE_IN'
  | 'TAKEAWAY'
  | 'DELIVERY';

type Report = {
  date: string;
  from: string;
  to: string;
  serviceMode: ServiceMode | null;

  sales: {
    currency: string;
    _sum: {
      totalAmount: string | null;
    };
    _count: number;
  }[];

  payments: {
    receivedCurrency: string;
    changeCurrency: string | null;
    method: string;
    _sum: {
      receivedAmount: string | null;
      changeAmount: string | null;
    };
    _count: number;
  }[];

  refunds: {
    currency: string;
    _sum: {
      amount: string | null;
    };
    _count: number;
  }[];

  expenses: {
    currency: string;
    _sum: {
      amount: string | null;
    };
  }[];

  served: number;
  subscriptions: number;
  cancelled: number;
  pendingPayments: number;
};

function todayKinshasa() {
  return new Date().toLocaleDateString(
    'en-CA',
    {
      timeZone: 'Africa/Kinshasa',
    },
  );
}

function serviceLabel(
  value: ServiceMode | null,
) {
  if (value === 'DINE_IN') {
    return 'Sur place';
  }

  if (value === 'TAKEAWAY') {
    return 'À emporter';
  }

  if (value === 'DELIVERY') {
    return 'Livraison';
  }

  return 'Tous';
}

export default function Reports() {
  const today = todayKinshasa();

  const [filters, setFilters] =
    useState({
      from: today,
      to: today,
      serviceMode: '',
    });

  const [applied, setApplied] =
    useState(filters);

  const params =
    new URLSearchParams();

  params.set(
    'from',
    applied.from,
  );

  params.set(
    'to',
    applied.to,
  );

  if (applied.serviceMode) {
    params.set(
      'serviceMode',
      applied.serviceMode,
    );
  }

  const q = useData<Report>(
    '/reports?' +
      params.toString(),
  );

  function submit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setApplied(filters);
  }

  function exportCSV() {
    if (!q.data) {
      return;
    }

    const rows:
      (string | number)[][] = [
      [
        'JAMI FOOD',
        'Rapport activité',
      ],

      [
        'Période',
        `${q.data.from} au ${q.data.to}`,
      ],

      [
        'Mode de service',
        serviceLabel(
          q.data.serviceMode,
        ),
      ],

      [],

      [
        'VENTES DIRECTES',
      ],

      [
        'Devise',
        'Montant',
        'Nombre',
      ],

      ...q.data.sales.map(
        (sale) => [
          sale.currency,
          sale._sum
            .totalAmount ?? '0',
          sale._count,
        ],
      ),

      [],

      [
        'ENCAISSEMENTS',
      ],

      [
        'Moyen',
        'Devise',
        'Montant reçu',
        'Monnaie rendue',
        'Devise de la monnaie',
        'Nombre',
      ],

      ...q.data.payments.map(
        (payment) => [
          payment.method,
          payment.receivedCurrency,
          payment._sum
            .receivedAmount ?? '0',
          payment._sum
            .changeAmount ?? '0',
          payment.changeCurrency ?? payment.receivedCurrency,
          payment._count,
        ],
      ),

      [],

      [
        'REMBOURSEMENTS',
      ],

      [
        'Devise',
        'Montant',
        'Nombre',
      ],

      ...q.data.refunds.map(
        (refund) => [
          refund.currency,
          refund._sum.amount ??
            '0',
          refund._count,
        ],
      ),

      [],

      [
        'DÉPENSES',
      ],

      [
        'Devise',
        'Montant',
      ],

      ...q.data.expenses.map(
        (expense) => [
          expense.currency,
          expense._sum.amount ??
            '0',
        ],
      ),

      [],

      [
        'INDICATEURS',
      ],

      [
        'Commandes servies',
        q.data.served,
      ],

      [
        'Abonnements actifs',
        q.data.subscriptions,
      ],

      [
        'Commandes annulées',
        q.data.cancelled,
      ],

      [
        'Paiements en attente',
        q.data.pendingPayments,
      ],
    ];

    downloadCSV(
      `rapport-${q.data.from}-${q.data.to}.csv`,
      rows,
    );
  }

  return (
    <>
      <Heading
        title="Rapports du restaurant"
        subtitle="Ventes, encaissements, remboursements, dépenses et service."
      >
        <div className="actions">
          <a className="secondary" href={'/api/v1/reports/export?'+params.toString()}>Exporter Excel (.xlsx)</a>
          <button
            type="button"
            className="secondary"
            onClick={exportCSV}
            disabled={!q.data}
          >
            Export CSV
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() =>
              window.print()
            }
          >
            Imprimer / PDF
          </button>
        </div>
      </Heading>

      <section className="card">
        <form
          onSubmit={submit}
          className="actions"
        >
          <label>
            Du
            <input
              type="date"
              value={filters.from}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  from:
                    event.target
                      .value,
                })
              }
              required
            />
          </label>

          <label>
            Au
            <input
              type="date"
              value={filters.to}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  to:
                    event.target
                      .value,
                })
              }
              required
            />
          </label>

          <label>
            Mode de service

            <select
              value={
                filters.serviceMode
              }
              onChange={(event) =>
                setFilters({
                  ...filters,
                  serviceMode:
                    event.target
                      .value,
                })
              }
            >
              <option value="">
                Tous
              </option>

              <option value="DINE_IN">
                Sur place
              </option>

              <option value="TAKEAWAY">
                À emporter
              </option>

              <option value="DELIVERY">
                Livraison
              </option>
            </select>
          </label>

          <button
            className="primary"
            type="submit"
          >
            Appliquer
          </button>
        </form>
      </section>

      <Loading
        loading={q.isLoading}
        error={q.error}
      />

      {q.data && (
        <>
          <p className="muted">
            Période du{' '}
            <strong>
              {q.data.from}
            </strong>{' '}
            au{' '}
            <strong>
              {q.data.to}
            </strong>
            {' · '}
            {serviceLabel(
              q.data.serviceMode,
            )}
            {' · Kinshasa'}
          </p>

          <div className="two-columns">
            <section className="card">
              <h2>
                Ventes directes
              </h2>

              {q.data.sales.map(
                (sale) => (
                  <div
                    className="item"
                    key={
                      sale.currency
                    }
                  >
                    <span>
                      {
                        sale._count
                      }{' '}
                      vente(s)
                    </span>

                    <strong>
                      {money(
                        sale._sum
                          .totalAmount ??
                          '0',
                        sale.currency,
                      )}
                    </strong>
                  </div>
                ),
              )}

              {!q.data.sales
                .length && (
                <p className="empty">
                  Aucune vente.
                </p>
              )}

              <p className="muted small">
                Les repas inclus dans
                un abonnement ne
                constituent pas une
                nouvelle vente.
              </p>
            </section>

            <section className="card">
              <h2>
                Encaissements bruts et monnaie
              </h2>

              {q.data.payments.map(
                (
                  payment,
                  index,
                ) => (
                  <div
                    className="item"
                    key={index}
                  >
                    <span>
                      {
                        payment.method
                      }
                      {' · '}
                      {
                        payment._count
                      }{' '}
                      opération(s)
                    </span>

                    <strong>
                      {money(
                        payment._sum
                          .receivedAmount ??
                          '0',
                        payment
                          .receivedCurrency,
                      )}
                    </strong>
                    <span className="muted small">Monnaie rendue : {money(payment._sum.changeAmount ?? '0', payment.changeCurrency ?? payment.receivedCurrency)}</span>
                  </div>
                ),
              )}

              {!q.data.payments
                .length && (
                <p className="empty">
                  Aucun encaissement.
                </p>
              )}
            </section>

            <section className="card">
              <h2>
                Remboursements
              </h2>

              {q.data.refunds.map(
                (refund) => (
                  <div
                    className="item"
                    key={
                      refund.currency
                    }
                  >
                    <span>
                      {
                        refund._count
                      }{' '}
                      remboursement(s)
                    </span>

                    <strong>
                      {money(
                        refund._sum
                          .amount ??
                          '0',
                        refund.currency,
                      )}
                    </strong>
                  </div>
                ),
              )}

              {!q.data.refunds
                .length && (
                <p className="empty">
                  Aucun remboursement.
                </p>
              )}
            </section>

            <section className="card">
              <h2>
                Dépenses
              </h2>

              {q.data.expenses.map(
                (expense) => (
                  <div
                    className="item"
                    key={
                      expense.currency
                    }
                  >
                    <span>
                      Sorties
                    </span>

                    <strong>
                      {money(
                        expense._sum
                          .amount ??
                          '0',
                        expense.currency,
                      )}
                    </strong>
                  </div>
                ),
              )}

              {!q.data.expenses
                .length && (
                <p className="empty">
                  Aucune dépense.
                </p>
              )}

              <Link
                href="/cash"
                className="secondary"
              >
                Voir les clôtures →
              </Link>
            </section>

            <section className="card">
              <h2>
                Service
              </h2>

              <p>
                Commandes servies :{' '}
                <strong>
                  {q.data.served}
                </strong>
              </p>

              <p>
                Abonnements actifs :{' '}
                <strong>
                  {
                    q.data
                      .subscriptions
                  }
                </strong>
              </p>
            </section>

            <section className="card">
              <h2>
                Contrôles
              </h2>

              <p>
                Commandes annulées :{' '}
                <strong>
                  {
                    q.data
                      .cancelled
                  }
                </strong>
              </p>

              <p>
                Paiements en attente :{' '}
                <strong>
                  {
                    q.data
                      .pendingPayments
                  }
                </strong>
              </p>
            </section>
          </div>
        </>
      )}
    </>
  );
}
