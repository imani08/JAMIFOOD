'use client';

import {
  FormEvent,
  useState,
} from 'react';

import {
  Heading,
  Loading,
  useData,
} from '../../components/common';

import { date } from '../../lib/api';

type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  createdAt: string;
  requestId: string;

  oldValue: unknown;
  newValue: unknown;
  metadata: unknown;

  ip: string | null;
  deviceId: string | null;

  actor: {
    username: string;
    firstName: string;
    lastName: string;
  } | null;
};

function JsonValue({
  value,
}: {
  value: unknown;
}) {
  if (
    value === null ||
    value === undefined
  ) {
    return (
      <span className="muted">
        —
      </span>
    );
  }

  return (
    <pre
      style={{
        whiteSpace: 'pre-wrap',
        fontSize: '0.8rem',
      }}
    >
      {JSON.stringify(
        value,
        null,
        2,
      )}
    </pre>
  );
}

export default function Audit() {
  const [page, setPage] =
    useState(1);

  const [filters, setFilters] =
    useState({
      q: '',
      action: '',
      entityType: '',
      from: '',
      to: '',
    });

  const [applied, setApplied] =
    useState(filters);

  const params =
    new URLSearchParams();

  params.set(
    'page',
    String(page),
  );

  params.set('limit', '25');

  if (applied.q) {
    params.set(
      'q',
      applied.q,
    );
  }

  if (applied.action) {
    params.set(
      'action',
      applied.action,
    );
  }

  if (applied.entityType) {
    params.set(
      'entityType',
      applied.entityType,
    );
  }

  if (applied.from) {
    params.set(
      'from',
      applied.from,
    );
  }

  if (applied.to) {
    params.set(
      'to',
      applied.to,
    );
  }

  const q = useData<AuditRow[]>(
    '/audit?' +
      params.toString(),
  );

  function submit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setPage(1);
    setApplied(filters);
  }

  function reset() {
    const empty = {
      q: '',
      action: '',
      entityType: '',
      from: '',
      to: '',
    };

    setFilters(empty);
    setApplied(empty);
    setPage(1);
  }

  return (
    <>
      <Heading
        title="Journal d’audit"
        subtitle="Historique des opérations sensibles, conservé sans réécriture."
      />

      <section className="card">
        <form
          onSubmit={submit}
          className="actions"
        >
          <label>
            Recherche
            <input
              type="search"
              placeholder="Action, objet ou ID"
              value={filters.q}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  q: e.target.value,
                })
              }
            />
          </label>

          <label>
            Action
            <input
              placeholder="Ex. PAYMENT"
              value={
                filters.action
              }
              onChange={(e) =>
                setFilters({
                  ...filters,
                  action:
                    e.target.value,
                })
              }
            />
          </label>

          <label>
            Objet
            <input
              placeholder="Ex. Order"
              value={
                filters.entityType
              }
              onChange={(e) =>
                setFilters({
                  ...filters,
                  entityType:
                    e.target.value,
                })
              }
            />
          </label>

          <label>
            Du
            <input
              type="date"
              value={filters.from}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  from:
                    e.target.value,
                })
              }
            />
          </label>

          <label>
            Au
            <input
              type="date"
              value={filters.to}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  to:
                    e.target.value,
                })
              }
            />
          </label>

          <button
            className="primary"
            type="submit"
          >
            Filtrer
          </button>

          <button
            className="secondary"
            type="button"
            onClick={reset}
          >
            Réinitialiser
          </button>
        </form>
      </section>

      <Loading
        loading={q.isLoading}
        error={q.error}
      />

      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                Horodatage
              </th>

              <th>
                Action
              </th>

              <th>
                Objet
              </th>

              <th>
                Auteur
              </th>

              <th>
                Détails
              </th>
            </tr>
          </thead>

          <tbody>
            {q.data?.map(
              (row) => (
                <tr key={row.id}>
                  <td>
                    {date(
                      row.createdAt,
                    )}
                  </td>

                  <td>
                    <strong>
                      {row.action}
                    </strong>

                    <br />

                    <small>
                      {
                        row.requestId
                      }
                    </small>
                  </td>

                  <td>
                    {
                      row.entityType
                    }

                    <br />

                    <small>
                      {row.entityId ??
                        '—'}
                    </small>
                  </td>

                  <td>
                    {row.actor ? (
                      <>
                        {
                          row.actor
                            .firstName
                        }{' '}
                        {
                          row.actor
                            .lastName
                        }

                        <br />

                        <small>
                          @
                          {
                            row.actor
                              .username
                          }
                        </small>
                      </>
                    ) : (
                      <span className="muted">
                        Système
                      </span>
                    )}
                  </td>

                  <td>
                    <details>
                      <summary>
                        Voir
                      </summary>

                      <h4>
                        Avant
                      </h4>

                      <JsonValue
                        value={
                          row.oldValue
                        }
                      />

                      <h4>
                        Après
                      </h4>

                      <JsonValue
                        value={
                          row.newValue
                        }
                      />

                      <h4>
                        Métadonnées
                      </h4>

                      <JsonValue
                        value={
                          row.metadata
                        }
                      />

                      {(row.ip ||
                        row.deviceId) && (
                        <p className="muted small">
                          IP :{' '}
                          {row.ip ??
                            '—'}
                          <br />
                          Terminal :{' '}
                          {row.deviceId ??
                            '—'}
                        </p>
                      )}
                    </details>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>

        {!q.isLoading &&
          !q.data?.length && (
            <p className="empty">
              Aucun événement
              trouvé.
            </p>
          )}
      </section>

      <div className="actions">
        <button
          className="secondary"
          disabled={page === 1}
          onClick={() =>
            setPage(
              (value) =>
                value - 1,
            )
          }
        >
          Précédent
        </button>

        <span>
          Page {page}
        </span>

        <button
          className="secondary"
          disabled={
            (q.data?.length ??
              0) < 25
          }
          onClick={() =>
            setPage(
              (value) =>
                value + 1,
            )
          }
        >
          Suivant
        </button>
      </div>
    </>
  );
}