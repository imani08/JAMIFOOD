'use client';

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  BrowserQRCodeReader,
  IScannerControls,
} from '@zxing/browser';

import { api } from '../../lib/api';

import {
  Feedback,
  Heading,
  useAction,
} from '../../components/common';

type MealRight = {
  id: string;
  serviceCode: string;
  status: string;
  businessDate: string;
  consumedAt: string | null;
  reservedAt: string | null;
};

type Subscription = {
  id: string;
  status: string;
  startsOn: string;
  endsOn: string;
  balance: string;
  currency: string;

  planVersion: {
    plan: {
      name: string;
    };
  };

  rights: MealRight[];
};

type Client = {
  id: string;
  firstName: string;
  lastName: string;

  photoObjectKey: string | null;

  category: {
    label: string;
  };

  subscriptions: Subscription[];
};

type ClientSearch = {
  id: string;
  firstName: string;
  lastName: string;
  ulcNumber: string | null;
  phone: string | null;

  category: {
    label: string;
  };
};

function matchesService(
  right: MealRight,
  service: string,
) {
  return (
    right.serviceCode === service ||
    (right.serviceCode === 'MAIN' &&
      ['LUNCH', 'DINNER'].includes(
        service,
      ))
  );
}

function controlDecision(
  client: Client,
  service: string,
) {
  const matchingRights =
    client.subscriptions.flatMap(
      (subscription) =>
        subscription.rights
          .filter((right) =>
            matchesService(
              right,
              service,
            ),
          )
          .map((right) => ({
            subscription,
            right,
          })),
    );

  const available =
    matchingRights.find(
      ({ subscription, right }) =>
        subscription.status ===
          'ACTIVE' &&
        Number(
          subscription.balance,
        ) <= 0 &&
        right.status ===
          'AVAILABLE',
    );

  if (available) {
    return {
      allowed: true,
      message:
        'Droit disponible pour ce service.',
      right:
        available.right,
      subscription:
        available.subscription,
    };
  }

  const reserved =
    matchingRights.find(
      ({ right }) =>
        right.status ===
        'RESERVED',
    );

  if (reserved) {
    return {
      allowed: false,
      message:
        'Ce droit est déjà réservé.',
      right: null,
      subscription:
        reserved.subscription,
    };
  }

  const consumed =
    matchingRights.find(
      ({ right }) =>
        right.status ===
        'CONSUMED',
    );

  if (consumed) {
    return {
      allowed: false,
      message:
        'Ce droit a déjà été consommé.',
      right: null,
      subscription:
        consumed.subscription,
    };
  }

  const suspended =
    client.subscriptions.find(
      (subscription) =>
        subscription.status ===
        'SUSPENDED',
    );

  if (suspended) {
    return {
      allowed: false,
      message:
        'L’abonnement est suspendu.',
      right: null,
      subscription:
        suspended,
    };
  }

  const unpaid =
    client.subscriptions.find(
      (subscription) =>
        Number(
          subscription.balance,
        ) > 0 ||
        subscription.status ===
          'PENDING_PAYMENT',
    );

  if (unpaid) {
    return {
      allowed: false,
      message:
        'Le paiement de l’abonnement est insuffisant ou en attente.',
      right: null,
      subscription: unpaid,
    };
  }

  const scheduled =
    client.subscriptions.find(
      (subscription) =>
        subscription.status ===
        'SCHEDULED',
    );

  if (scheduled) {
    return {
      allowed: false,
      message:
        'L’abonnement est planifié mais n’est pas encore actif.',
      right: null,
      subscription:
        scheduled,
    };
  }

  if (
    !client.subscriptions.length
  ) {
    return {
      allowed: false,
      message:
        'Aucun abonnement actif.',
      right: null,
      subscription: null,
    };
  }

  return {
    allowed: false,
    message:
      'Ce service n’est pas couvert aujourd’hui.',
    right: null,
    subscription:
      client.subscriptions[0],
  };
}

function serviceName(
  service: string,
) {
  if (
    service === 'BREAKFAST'
  ) {
    return 'Petit-déjeuner';
  }

  if (service === 'LUNCH') {
    return 'Déjeuner';
  }

  if (service === 'DINNER') {
    return 'Dîner';
  }

  return service;
}

export default function Meals() {
  const action =
    useAction();

  const videoRef =
    useRef<HTMLVideoElement | null>(
      null,
    );

  const controlsRef =
    useRef<IScannerControls | null>(
      null,
    );

  const handledRef =
    useRef(false);

  const [
    scannerActive,
    setScannerActive,
  ] = useState(false);

  const [
    cameraError,
    setCameraError,
  ] = useState('');

  const [
    token,
    setToken,
  ] = useState('');

  const [
    client,
    setClient,
  ] = useState<Client | null>(
    null,
  );

  const [
    service,
    setService,
  ] = useState('LUNCH');

  const [
    source,
    setSource,
  ] = useState<
    'QR' | 'MANUAL' | null
  >(null);

  const [
    manualQuery,
    setManualQuery,
  ] = useState('');

  const [
    manualResults,
    setManualResults,
  ] = useState<
    ClientSearch[]
  >([]);

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current =
      null;

    setScannerActive(false);
  }

  async function scanToken(
    qrToken: string,
  ) {
    const result =
      await action.run(
        () =>
          api<Client>(
            '/clients/scan',
            {
              token:
                qrToken.trim(),
            },
          ),

        'Client identifié. Aucun repas n’a été consommé.',
      );

    if (result) {
      setClient(result);
      setSource('QR');
    }

    return result;
  }

  useEffect(() => {
    if (
      !scannerActive ||
      !videoRef.current
    ) {
      return;
    }

    handledRef.current =
      false;

    setCameraError('');

    const reader =
      new BrowserQRCodeReader();

    let mounted = true;

    reader
      .decodeFromConstraints(
        {
          audio: false,

          video: {
            facingMode: {
              ideal:
                'environment',
            },
          },
        },

        videoRef.current,

        async (
          result,
          _error,
          controls,
        ) => {
          if (
            !mounted ||
            !result ||
            handledRef.current
          ) {
            return;
          }

          const value =
            result
              .getText()
              .trim();

          if (
            !value.startsWith(
              'JAMI-',
            )
          ) {
            setCameraError(
              'QR détecté, mais il ne s’agit pas d’un QR JAMI FOOD.',
            );

            return;
          }

          handledRef.current =
            true;

          controls.stop();

          controlsRef.current =
            null;

          setScannerActive(
            false,
          );

          setToken(value);

          await scanToken(
            value,
          );
        },
      )
      .then((controls) => {
        if (!mounted) {
          controls.stop();
          return;
        }

        controlsRef.current =
          controls;
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }

        setCameraError(
          error instanceof Error
            ? error.message
            : 'Impossible d’accéder à la caméra.',
        );

        setScannerActive(
          false,
        );
      });

    return () => {
      mounted = false;

      controlsRef.current?.stop();

      controlsRef.current =
        null;
    };
  }, [scannerActive]);

  async function manualScan(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!token.trim()) {
      return;
    }

    await scanToken(token);
  }

  async function searchClient(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !manualQuery.trim()
    ) {
      return;
    }

    const results =
      await action.run(
        () =>
          api<ClientSearch[]>(
            `/clients?page=1&limit=10&q=${encodeURIComponent(
              manualQuery,
            )}`,
          ),

        'Recherche terminée.',
      );

    if (results) {
      setManualResults(
        results,
      );
    }
  }

  async function controlManual(
    id: string,
  ) {
    const result =
      await action.run(
        () =>
          api<Client>(
            `/clients/${id}/control`,
            {},
          ),

        'Client identifié manuellement. Aucun repas n’a été consommé.',
      );

    if (result) {
      setClient(result);
      setSource('MANUAL');
    }
  }

  async function refreshClient() {
    if (!client) {
      return;
    }

    if (
      source === 'QR' &&
      token
    ) {
      const refreshed =
        await api<Client>(
          '/clients/scan',
          {
            token,
          },
        );

      setClient(
        refreshed,
      );

      return;
    }

    const refreshed =
      await api<Client>(
        `/clients/${client.id}/control`,
        {},
      );

    setClient(
      refreshed,
    );
  }

  async function serveMeal(
    rightId: string,
  ) {
    if (
      !window.confirm(
        `Confirmer que le ${serviceName(
          service,
        ).toLowerCase()} a réellement été remis au client ?`,
      )
    ) {
      return;
    }

    await action.run(
      async () => {
        await api(
          '/meals/consume',
          {
            mealRightId:
              rightId,

            serviceCode:
              service,
          },
        );

        await refreshClient();
      },

      'Repas servi enregistré.',
    );
  }

  const decision =
    client
      ? controlDecision(
          client,
          service,
        )
      : null;

  return (
    <>
      <Heading
        title="Contrôle des repas"
        subtitle="Scanner, vérifier les droits puis confirmer explicitement la remise du repas."
      />

      <Feedback
        {...action}
      />

      {cameraError && (
        <p className="error">
          {cameraError}
        </p>
      )}

      <div className="two-columns">
        <section className="card">
          <h2>
            Scanner un QR Code
          </h2>

          {!scannerActive ? (
            <button
              className="primary"
              onClick={() => {
                setCameraError(
                  '',
                );

                setScannerActive(
                  true,
                );
              }}
            >
              Scanner avec la caméra
            </button>
          ) : (
            <>
              <div className="scanner-box">
                <video
                  ref={videoRef}
                  className="scanner-video"
                  playsInline
                  muted
                />
              </div>

              <button
                className="secondary"
                onClick={
                  stopScanner
                }
              >
                Arrêter la caméra
              </button>
            </>
          )}

          <form
            className="section"
            onSubmit={
              manualScan
            }
          >
            <label>
              Saisie manuelle du
              code
              <input
                value={token}
                onChange={(
                  event,
                ) =>
                  setToken(
                    event.target
                      .value,
                  )
                }
                placeholder="JAMI-…"
              />
            </label>

            <button
              className="secondary"
              disabled={
                action.busy
              }
            >
              Contrôler ce code
            </button>
          </form>
        </section>

        <section className="card">
          <h2>
            Recherche manuelle
          </h2>

          <form
            onSubmit={
              searchClient
            }
          >
            <label>
              Nom, matricule,
              téléphone ou ID
              <input
                value={
                  manualQuery
                }
                onChange={(
                  event,
                ) =>
                  setManualQuery(
                    event.target
                      .value,
                  )
                }
                placeholder="Rechercher…"
              />
            </label>

            <button
              className="secondary"
              disabled={
                action.busy
              }
            >
              Rechercher
            </button>
          </form>

          <div className="list section">
            {manualResults.map(
              (result) => (
                <article
                  className="item"
                  key={
                    result.id
                  }
                >
                  <span>
                    <strong>
                      {
                        result.firstName
                      }{' '}
                      {
                        result.lastName
                      }
                    </strong>

                    <br />

                    <small className="muted">
                      {
                        result
                          .category
                          .label
                      }
                      {' · '}
                      {result.ulcNumber ??
                        result.phone ??
                        result.id}
                    </small>
                  </span>

                  <button
                    className="secondary"
                    disabled={
                      action.busy
                    }
                    onClick={() =>
                      controlManual(
                        result.id,
                      )
                    }
                  >
                    Contrôler
                  </button>
                </article>
              ),
            )}
          </div>
        </section>
      </div>

      {client && decision && (
        <section className="card section">
          <div className="control-client">
            {client.photoObjectKey ? (
              <img
                className="client-photo"
                src={`/api/v1/client-photos/${client.photoObjectKey}`}
                alt={`${client.firstName} ${client.lastName}`}
              />
            ) : (
              <div className="client-photo client-photo-empty">
                Photo
              </div>
            )}

            <div>
              <p className="eyebrow">
                CONTRÔLE CLIENT
              </p>

              <h2>
                {
                  client.firstName
                }{' '}
                {
                  client.lastName
                }
              </h2>

              <p className="muted">
                {
                  client.category
                    .label
                }
              </p>

              <span className="badge">
                Identification :{' '}
                {source === 'QR'
                  ? 'QR CODE'
                  : 'RECHERCHE MANUELLE'}
              </span>
            </div>
          </div>

          <div className="section">
            <label>
              Service en cours
              <select
                value={service}
                onChange={(
                  event,
                ) =>
                  setService(
                    event.target
                      .value,
                  )
                }
              >
                <option value="BREAKFAST">
                  Petit-déjeuner
                </option>

                <option value="LUNCH">
                  Déjeuner
                </option>

                <option value="DINNER">
                  Dîner
                </option>
              </select>
            </label>
          </div>

          <div
            className={
              decision.allowed
                ? 'control-decision control-approved'
                : 'control-decision control-refused'
            }
          >
            <strong>
              {decision.allowed
                ? '✓ REPAS AUTORISÉ'
                : '✕ REPAS NON AUTORISÉ'}
            </strong>

            <p>
              {
                decision.message
              }
            </p>
          </div>

          {decision.allowed &&
            decision.right && (
              <button
                className="primary section"
                disabled={
                  action.busy
                }
                onClick={() =>
                  serveMeal(
                    decision.right!
                      .id,
                  )
                }
              >
                REPAS SERVI
              </button>
            )}

          <section className="section">
            <h3>
              Abonnements et
              droits du jour
            </h3>

            {!client.subscriptions
              .length && (
              <p className="empty">
                Aucun abonnement.
              </p>
            )}

            {client.subscriptions.map(
              (subscription) => (
                <article
                  className="card section"
                  key={
                    subscription.id
                  }
                >
                  <div className="section-title">
                    <div>
                      <strong>
                        {
                          subscription
                            .planVersion
                            .plan.name
                        }
                      </strong>

                      <p className="muted small">
                        {subscription.startsOn.slice(
                          0,
                          10,
                        )}
                        {' → '}
                        {subscription.endsOn.slice(
                          0,
                          10,
                        )}
                      </p>
                    </div>

                    <span className="badge">
                      {
                        subscription.status
                      }
                    </span>
                  </div>

                  {Number(
                    subscription.balance,
                  ) > 0 && (
                    <p className="error">
                      Solde restant :{' '}
                      {
                        subscription.balance
                      }{' '}
                      {
                        subscription.currency
                      }
                    </p>
                  )}

                  {subscription.rights.map(
                    (right) => (
                      <div
                        className="item"
                        key={
                          right.id
                        }
                      >
                        <span>
                          {right.serviceCode ===
                          'MAIN'
                            ? 'Repas principal'
                            : serviceName(
                                right.serviceCode,
                              )}

                          {right.consumedAt && (
                            <>
                              <br />
                              <small className="muted">
                                Consommé :{' '}
                                {new Date(
                                  right.consumedAt,
                                ).toLocaleString(
                                  'fr-FR',
                                  {
                                    timeZone:
                                      'Africa/Kinshasa',
                                  },
                                )}
                              </small>
                            </>
                          )}
                        </span>

                        <span className="badge">
                          {
                            right.status
                          }
                        </span>
                      </div>
                    ),
                  )}

                  {!subscription
                    .rights.length && (
                    <p className="muted">
                      Aucun droit pour
                      aujourd’hui.
                    </p>
                  )}
                </article>
              ),
            )}
          </section>
        </section>
      )}
    </>
  );
}