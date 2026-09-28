'use client';

import { useState } from 'react';

import {
  api,
  date,
  money,
} from '../../lib/api';

import {
  Feedback,
  Heading,
  useAction,
  useData,
} from '../../components/common';

import { useUser } from '../../components/shell';

type Setting = {
  key: string;
  value: Record<string, unknown>;
  validated: boolean;
  validatedAt: string | null;
  updatedAt: string;
};

type ClientCategory = {
  id: string;
  code: string;
  label: string;
  active: boolean;
};

type Rate = {
  id: string;
  rate: string;
  source: string;
  effectiveFrom: string;
};

function SettingEditor({
  setting,
}: {
  setting: Setting;
}) {
  const action = useAction();

  const [text, setText] =
    useState(
      JSON.stringify(
        setting.value,
        null,
        2,
      ),
    );

  async function save() {
    let value:
      | Record<string, unknown>
      | undefined;

    try {
      value = JSON.parse(text);
    } catch {
      window.alert(
        'Le JSON saisi est invalide.',
      );
      return;
    }

    await action.run(
      () =>
        api(
          `/settings/${encodeURIComponent(
            setting.key,
          )}`,
          {
            value,
          },
        ),
      'Paramètre modifié. Il doit être validé avant utilisation en production.',
    );
  }

  async function validate() {
    if (
      !window.confirm(
        'Valider cette règle commerciale ?',
      )
    ) {
      return;
    }

    await action.run(
      () =>
        api(
          `/settings/${encodeURIComponent(
            setting.key,
          )}/validate`,
          {},
        ),
      'Paramètre validé.',
    );
  }

  return (
    <details className="card section">
      <summary>
        <strong>{setting.key}</strong>
        {' '}
        <span className="badge">
          {setting.validated
            ? 'VALIDÉ'
            : 'À VALIDER'}
        </span>
      </summary>

      <Feedback
        error={action.error}
        notice={action.notice}
      />

      <p className="muted small">
        Dernière modification :
        {' '}
        {date(setting.updatedAt)}
      </p>

      {setting.key === 'calendrier' && (
        <div className="section">
          <p>Jours de service : lundi à vendredi. Les jours fériés légaux RDC sont exclus automatiquement.</p>
          <label>
            Fermetures exceptionnelles (une date AAAA-MM-JJ par ligne)
            <textarea
              value={Array.isArray(setting.value.closures) ? (setting.value.closures as string[]).join('\n') : ''}
              onChange={(event) => {
                const closures = event.target.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
                setText(JSON.stringify({ weekdays: [1, 2, 3, 4, 5], publicHolidays: 'CD_LEGAL', closures }, null, 2));
              }}
              placeholder="2026-12-24"
            />
          </label>
          <p className="muted small">Les jours fériés légaux de la RDC sont exclus automatiquement du calendrier.</p>
        </div>
      )}

      <label>
        Configuration
        <textarea
          style={{
            minHeight: 180,
            fontFamily: 'monospace',
          }}
          value={text}
          onChange={(event) =>
            setText(
              event.target.value,
            )
          }
        />
      </label>

      <div className="actions">
        <button
          className="primary"
          disabled={action.busy}
          onClick={save}
        >
          Enregistrer
        </button>

        {!setting.validated && (
          <button
            className="secondary"
            disabled={action.busy}
            onClick={validate}
          >
            Valider la règle
          </button>
        )}
      </div>
    </details>
  );
}

export default function Settings() {
  const settings =
    useData<Setting[]>('/settings');

  const rates = useData<Rate[]>(
    '/exchange-rates',
  );

  const clientCategories =
    useData<ClientCategory[]>(
      '/commercial/client-categories',
    );

  const action = useAction();
  const categoryAction = useAction();

  const user = useUser();

  async function createCategory(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    const result =
      await categoryAction.run(
        () =>
          api(
            '/commercial/client-categories',
            {
              code: String(
                data.get('code') ?? '',
              ),
              label: String(
                data.get('label') ?? '',
              ),
            },
          ),
        'Catégorie client créée.',
      );

    if (result) {
      form.reset();
    }
  }

  return (
    <>
      <Heading
        title="Paramètres commerciaux"
        subtitle="Les décisions non validées restent explicitement séparées des paramètres de production."
      />

      <section>
        <h2>
          Règles commerciales
        </h2>

        {settings.data?.map(
          (setting) => (
            <SettingEditor
              key={setting.key}
              setting={setting}
            />
          ),
        )}
      </section>

      <div className="two-columns section">
        <section className="card">
          <h2>
            Catégories de clients
          </h2>

          <Feedback
            error={
              categoryAction.error
            }
            notice={
              categoryAction.notice
            }
          />

          {clientCategories.data?.map(
            (category) => (
              <div
                key={category.id}
                className="item"
              >
                <span>
                  <strong>
                    {category.label}
                  </strong>
                  <br />
                  <small className="muted">
                    {category.code}
                  </small>
                </span>

                <span className="badge">
                  {category.active
                    ? 'ACTIVE'
                    : 'INACTIVE'}
                </span>
              </div>
            ),
          )}

          {user?.permissions.includes(
            'pricing.update',
          ) && (
            <form
              className="section"
              onSubmit={createCategory}
            >
              <label>
                Code
                <input
                  name="code"
                  placeholder="AUTRE_CLIENT"
                  required
                />
              </label>

              <label>
                Libellé
                <input
                  name="label"
                  placeholder="Autre client autorisé"
                  required
                />
              </label>

              <button
                className="primary"
                disabled={
                  categoryAction.busy
                }
              >
                Ajouter
              </button>
            </form>
          )}
        </section>

        <section className="card">
          <h2>
            Taux de gestion USD / CDF
          </h2>

          {rates.data
            ?.slice(0, 10)
            .map((rate) => (
              <p key={rate.id}>
                1 USD ={' '}
                <strong>
                  {money(
                    rate.rate,
                    'CDF',
                  )}
                </strong>

                <br />

                <small className="muted">
                  {rate.source}
                  {' · '}
                  {date(
                    rate.effectiveFrom,
                  )}
                </small>
              </p>
            ))}

          {user?.permissions.includes(
            'pricing.update',
          ) && (
            <form
              onSubmit={(event) => {
                event.preventDefault();

                const data =
                  new FormData(
                    event.currentTarget,
                  );

                action.run(
                  () =>
                    api(
                      '/exchange-rates',
                      {
                        rate: String(
                          data.get(
                            'rate',
                          ) ?? '',
                        ),
                        source: String(
                          data.get(
                            'source',
                          ) ?? '',
                        ),
                        effectiveFrom:
                          new Date().toISOString(),
                      },
                    ),
                  'Nouveau taux enregistré.',
                );
              }}
            >
              <Feedback
                error={action.error}
                notice={action.notice}
              />

              <label>
                CDF pour 1 USD
                <input
                  name="rate"
                  type="number"
                  min="0"
                  step="0.00000001"
                  required
                />
              </label>

              <label>
                Source / décision
                <input
                  name="source"
                  required
                />
              </label>

              <button
                className="primary"
                disabled={action.busy}
              >
                Enregistrer le taux
              </button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
