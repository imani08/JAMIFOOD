'use client';

import { FormEvent, useState } from 'react';
import QRCode from 'qrcode';

import {
  api,
  apiForm,
  date,
} from '../../lib/api';

import {
  Feedback,
  Heading,
  Loading,
  useAction,
  useData,
} from '../../components/common';
import { useUser } from '../../components/shell';

type Client = {
  id: string;
  firstName: string;
  lastName: string;
  ulcNumber: string | null;
  categoryId: string;
  category: {
    id: string;
    code: string;
    label: string;
  };
  phone: string | null;
  email: string | null;
  faculty: string | null;
  promotion: string | null;
  residency: string | null;
  photoObjectKey: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  portalAccount?: {created?:boolean;invitationSent?:boolean;developmentUrl?:string;reason?:string;error?:string;alreadyActive?:boolean};
};

type QRHistory = {
  id: string;
  action: string;
  createdAt: string;
  metadata: unknown;
};

type QRInfo = {
  id: string;
  status: string;
  issuedAt: string;
  revokedAt: string | null;
  replacedById: string | null;
  history: QRHistory[];
};

type ClientDetail = Client & {
  qrCodes: QRInfo[];
  account: null | {id:string;type:string;verificationStatus:string;emailVerifiedAt:string|null;createdAt:string};
};

type GeneratedQR = {
  token: string;

  qrCode: {
    id: string;
    status: string;
    issuedAt: string;
  };
};

type Category = {
  id: string;
  code: string;
  label: string;
};

type PhotoUpload = {
  objectKey: string;
  url: string;
};

export default function Clients() {
  const currentUser = useUser();
  const [q, setQ] =
    useState('');

  const [page, setPage] =
    useState(1);

  const [selected, setSelected] =
    useState<ClientDetail | null>(
      null,
    );
  const [portalInviteLink,setPortalInviteLink]=useState('');
  const [portalMessage,setPortalMessage]=useState('');

  const [
    generatedToken,
    setGeneratedToken,
  ] = useState('');

  const [
    generatedQrImage,
    setGeneratedQrImage,
  ] = useState('');

  const clients =
    useData<Client[]>(
      '/clients?page=' +
        page +
        '&q=' +
        encodeURIComponent(q),
    );

  const categories =
    useData<Category[]>(
      '/clients/categories',
    );

  const action =
    useAction();

  async function loadClient(
    id: string,
  ) {
    const detail =
      await api<ClientDetail>(
        `/clients/${id}`,
      );

    setPortalInviteLink('');
    setPortalMessage('');
    setSelected(detail);

    return detail;
  }

  async function createClient(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form =
      event.currentTarget;

    const data =
      new FormData(form);

    await action.run(
      async () => {
        const photo =
          data.get('photo');

        let photoObjectKey:
          | string
          | undefined;

        if (
          photo instanceof File &&
          photo.size > 0
        ) {
          const photoForm =
            new FormData();

          photoForm.append(
            'photo',
            photo,
          );

          const uploaded =
            await apiForm<PhotoUpload>(
              '/client-photos',
              photoForm,
            );

          photoObjectKey =
            uploaded.objectKey;
        }

        const optional = (
          name: string,
        ) => {
          const value =
            String(
              data.get(name) ?? '',
            ).trim();

          return value || undefined;
        };

        const client =
          await api<Client>(
            '/clients',
            {
              firstName:
                String(
                  data.get(
                    'firstName',
                  ),
                ).trim(),

              lastName:
                String(
                  data.get(
                    'lastName',
                  ),
                ).trim(),

              categoryId:
                String(
                  data.get(
                    'categoryId',
                  ),
                ),

              ulcNumber:
                optional(
                  'ulcNumber',
                ),

              faculty:
                optional(
                  'faculty',
                ),

              promotion:
                optional(
                  'promotion',
                ),

              residency:
                optional(
                  'residency',
                ),

              phone:
                optional('phone'),

              email:
                optional('email'),

              ...(photoObjectKey
                ? {
                    photoObjectKey,
                  }
                : {}),
            },
          );

        form.reset();

        await loadClient(
          client.id,
        );
        setPortalInviteLink(client.portalAccount?.developmentUrl??'');
        setPortalMessage(client.portalAccount?.error??(client.portalAccount?.invitationSent?'Compte portail créé et invitation envoyée.':client.portalAccount?.developmentUrl?'Compte créé. Ouvrez le lien local affiché ci-dessous.':''));

        return client;
      },

      'Client enregistré.',
    );
  }

  async function updateClient(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selected) {
      return;
    }

    const data =
      new FormData(
        event.currentTarget,
      );

    await action.run(
      async () => {
        const photo =
          data.get('photo');

        let photoObjectKey =
          selected.photoObjectKey ??
          undefined;

        if (
          photo instanceof File &&
          photo.size > 0
        ) {
          const photoForm =
            new FormData();

          photoForm.append(
            'photo',
            photo,
          );

          const uploaded =
            await apiForm<PhotoUpload>(
              '/client-photos',
              photoForm,
            );

          photoObjectKey =
            uploaded.objectKey;
        }

        const optional = (
          name: string,
        ) => {
          const value =
            String(
              data.get(name) ?? '',
            ).trim();

          return value || undefined;
        };

        await api(
          `/clients/${selected.id}`,
          {
            firstName:
              String(
                data.get(
                  'firstName',
                ),
              ).trim(),

            lastName:
              String(
                data.get(
                  'lastName',
                ),
              ).trim(),

            categoryId:
              String(
                data.get(
                  'categoryId',
                ),
              ),

            ulcNumber:
              optional(
                'ulcNumber',
              ),

            faculty:
              optional(
                'faculty',
              ),

            promotion:
              optional(
                'promotion',
              ),

            residency:
              optional(
                'residency',
              ),

            phone:
              optional('phone'),

            email:
              optional('email'),

            ...(photoObjectKey
              ? {
                  photoObjectKey,
                }
              : {}),
          },
        );

        const refreshed=await loadClient(
          selected.id,
        );
        if(!refreshed.account&&refreshed.email&&currentUser?.permissions.includes('clients.create')){
          const invite=await api<{developmentUrl?:string;invitationSent:boolean}>(`/client/accounts/from-client/${selected.id}`,{});
          await loadClient(selected.id);
          setPortalInviteLink(invite.developmentUrl??'');
          setPortalMessage(invite.invitationSent?'Compte portail créé et invitation envoyée.':invite.developmentUrl?'Compte créé. Ouvrez le lien local affiché ci-dessous.':'Compte portail créé, mais aucun courriel n’a pu être envoyé. Configurez le service de messagerie puis renvoyez l’invitation.');
        }
      },

      'Fiche client mise à jour.',
    );
  }

  async function decideClientAccount(decision:'VERIFIED'|'REJECTED') {
    if(!selected?.account) return;
    await action.run(async()=>{
      await api(`/client/verification/${selected.account!.id}`,{decision,reason:decision==='VERIFIED'?'Identité ULC contrôlée depuis la fiche client.':'Demande rejetée après vérification depuis la fiche client.'});
      await loadClient(selected.id);
    },decision==='VERIFIED'?'Compte client validé.':'Demande de compte rejetée.');
  }

  async function linkExistingAccount() {
    if(!selected||!currentUser?.permissions.includes('clients.verify'))return;
    if(!window.confirm('Rattacher au client le compte portail vérifié qui utilise le même courriel? Ses sessions seront fermées, son ancien QR révoqué et sa validation ULC remise en attente.'))return;
    await action.run(async()=>{await api(`/clients/${selected.id}/account/link`,{});await loadClient(selected.id);},'Compte portail rattaché. La validation ULC est à effectuer.');
  }

  async function createPortalAccount() {
    if(!selected||!currentUser?.permissions.includes('clients.create'))return;
    await action.run(async()=>{const result=await api<{developmentUrl?:string;invitationSent:boolean;alreadyActive?:boolean}>(`/client/accounts/from-client/${selected.id}`,{});await loadClient(selected.id);setPortalInviteLink(result.developmentUrl??'');setPortalMessage(result.alreadyActive?'Ce compte portail est déjà activé.':result.invitationSent?'Invitation envoyée. Le client choisira son mot de passe depuis le lien reçu.':result.developmentUrl?'Compte créé. Ouvrez le lien local affiché ci-dessous.':'Compte portail créé, mais aucun courriel n’a pu être envoyé. Configurez le service de messagerie puis renvoyez l’invitation.');},'Compte portail prêt.');
  }

  async function showQr(
    result: GeneratedQR,
  ) {
    const image =
      await QRCode.toDataURL(
        result.token,
        {
          width: 340,
          margin: 2,

          errorCorrectionLevel:
            'M',
        },
      );

    setGeneratedToken(
      result.token,
    );

    setGeneratedQrImage(
      image,
    );
  }

  async function issueQr() {
    if (!selected) {
      return;
    }

    await action.run(
      async () => {
        const result =
          await api<GeneratedQR>(
            `/clients/${selected.id}/qr/issue`,
            {},
          );

        await showQr(
          result,
        );

        await loadClient(
          selected.id,
        );
      },

      'QR Code émis.',
    );
  }

  async function replaceQr() {
    if (!selected) {
      return;
    }

    if (
      !window.confirm(
        'Remplacer le QR Code actif ? L’ancien sera immédiatement inutilisable.',
      )
    ) {
      return;
    }

    await action.run(
      async () => {
        const result =
          await api<GeneratedQR>(
            `/clients/${selected.id}/qr/replace`,
            {},
          );

        await showQr(
          result,
        );

        await loadClient(
          selected.id,
        );
      },

      'QR Code remplacé.',
    );
  }

  async function revokeQr(
    qrCodeId: string,
  ) {
    if (!selected) {
      return;
    }

    if (
      !window.confirm(
        'Révoquer ce QR Code ? Cette opération est immédiate.',
      )
    ) {
      return;
    }

    await action.run(
      async () => {
        await api(
          `/clients/${selected.id}/qr/${qrCodeId}/revoke`,
          {},
        );

        setGeneratedToken('');
        setGeneratedQrImage('');

        await loadClient(
          selected.id,
        );
      },

      'QR Code révoqué.',
    );
  }

  function downloadQr() {
    if (
      !generatedQrImage ||
      !selected
    ) {
      return;
    }

    const anchor =
      document.createElement('a');

    anchor.href =
      generatedQrImage;

    anchor.download =
      `JAMI-FOOD-${selected.lastName}-${selected.firstName}.png`;

    anchor.click();
  }

  function printQr() {
    document.body.classList.add(
      'print-qr-mode',
    );

    window.print();

    window.setTimeout(
      () => {
        document.body.classList.remove(
          'print-qr-mode',
        );
      },
      500,
    );
  }

  async function archiveClient() {
    if (!selected) {
      return;
    }

    if (
      !window.confirm(
        'Archiver cette fiche ? Son historique restera conservé et ses QR actifs seront révoqués.',
      )
    ) {
      return;
    }

    await action.run(
      async () => {
        await api(
          `/clients/${selected.id}/archive`,
          {},
        );

        setSelected(null);
        setGeneratedToken('');
        setGeneratedQrImage('');
      },

      'Client archivé.',
    );
  }

  const activeQr =
    selected?.qrCodes.find(
      (code) =>
        code.status ===
        'ACTIVE',
    );

  return (
    <>
      <Heading
        title="Clients du restaurant"
        subtitle="Fiches clients, photos et QR Codes sécurisés."
      />

      <Feedback
        {...action}
      />

      <div className="two-columns">
        <section className="card">
          <h2>
            Retrouver un client
          </h2>

          <label>
            Nom, matricule,
            téléphone ou ID
            <input
              value={q}
              onChange={(event) => {
                setQ(
                  event.target.value,
                );

                setPage(1);
              }}
              placeholder="Rechercher…"
            />
          </label>

          <Loading
            loading={
              clients.isLoading
            }
            error={
              clients.error
            }
          />

          <div className="list">
            {clients.data?.map(
              (client) => (
                <article
                  className="item"
                  key={client.id}
                >
                  <span>
                    <strong>
                      {
                        client.firstName
                      }{' '}
                      {
                        client.lastName
                      }
                    </strong>

                    <br />

                    <small className="muted">
                      {
                        client
                          .category
                          .label
                      }
                      {' · '}
                      {client.ulcNumber ??
                        client.phone ??
                        client.id}
                    </small>
                  </span>

                  <button
                    className="secondary"
                    disabled={
                      action.busy
                    }
                    onClick={() =>
                      action.run(
                        () =>
                          loadClient(
                            client.id,
                          ),

                        'Fiche chargée.',
                      )
                    }
                  >
                    Ouvrir
                  </button>
                </article>
              ),
            )}
          </div>

          <div className="actions">
            <button
              className="secondary"
              disabled={
                page === 1
              }
              onClick={() =>
                setPage(
                  page - 1,
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
                (clients.data
                  ?.length ??
                  0) < 25
              }
              onClick={() =>
                setPage(
                  page + 1,
                )
              }
            >
              Suivant
            </button>
          </div>
        </section>

        <form
          className="card"
          onSubmit={
            createClient
          }
        >
          <h2>
            Nouvelle fiche
            client
          </h2>

          <div className="form-grid">
            <label>
              Prénom
              <input
                name="firstName"
                required
              />
            </label>

            <label>
              Nom
              <input
                name="lastName"
                required
              />
            </label>
          </div>

          <label>
            Catégorie
            <select
              name="categoryId"
              required
            >
              {categories.data?.map(
                (category) => (
                  <option
                    key={
                      category.id
                    }
                    value={
                      category.id
                    }
                  >
                    {
                      category.label
                    }
                  </option>
                ),
              )}
            </select>
          </label>

          <div className="form-grid">
            <label>
              Matricule ULC
              <input
                name="ulcNumber"
              />
            </label>

            <label>
              Téléphone
              <input
                name="phone"
              />
            </label>

            <label>
              Faculté
              <input
                name="faculty"
              />
            </label>

            <label>
              Promotion
              <input
                name="promotion"
              />
            </label>

            <label>
              Résidence
              <input
                name="residency"
              />
            </label>

            <label>
              Courriel
              <input
                name="email"
                type="email"
              />
            </label>
          </div>

          <label>
            Photo
            <input
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
            />

            <small className="muted">
              Facultative · JPG,
              PNG ou WEBP · 4 Mo
              maximum.
            </small>
          </label>

          <button
            className="primary"
            disabled={
              action.busy
            }
          >
            Enregistrer le
            client
          </button>
        </form>
      </div>

      {selected && (
        <section className="card section">
          <div className="client-profile">
            <div>
              {selected.photoObjectKey ? (
                <img
                  className="client-photo"
                  src={`/api/v1/client-photos/${selected.photoObjectKey}`}
                  alt={`${selected.firstName} ${selected.lastName}`}
                />
              ) : (
                <div className="client-photo client-photo-empty">
                  Photo
                </div>
              )}
            </div>

            <div>
              <p className="eyebrow">
                FICHE CLIENT
              </p>

              <h2>
                {
                  selected.firstName
                }{' '}
                {
                  selected.lastName
                }
              </h2>

              <p className="muted">
                {
                  selected
                    .category
                    .label
                }
                {' · '}
                {selected.ulcNumber ??
                  'Sans matricule'}
              </p>

              <p className="small muted">
                ID :{' '}
                {selected.id}
              </p>
            </div>
          </div>

          <form
            key={
              selected.id +
              selected.updatedAt
            }
            className="section"
            onSubmit={
              updateClient
            }
          >
            <h3>
              Informations
            </h3>

            <div className="form-grid">
              <label>
                Prénom
                <input
                  name="firstName"
                  defaultValue={
                    selected.firstName
                  }
                  required
                />
              </label>

              <label>
                Nom
                <input
                  name="lastName"
                  defaultValue={
                    selected.lastName
                  }
                  required
                />
              </label>

              <label>
                Catégorie
                <select
                  name="categoryId"
                  defaultValue={
                    selected.categoryId
                  }
                >
                  {categories.data?.map(
                    (
                      category,
                    ) => (
                      <option
                        key={
                          category.id
                        }
                        value={
                          category.id
                        }
                      >
                        {
                          category.label
                        }
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label>
                Matricule ULC
                <input
                  name="ulcNumber"
                  defaultValue={
                    selected.ulcNumber ??
                    ''
                  }
                />
              </label>

              <label>
                Faculté
                <input
                  name="faculty"
                  defaultValue={
                    selected.faculty ??
                    ''
                  }
                />
              </label>

              <label>
                Promotion
                <input
                  name="promotion"
                  defaultValue={
                    selected.promotion ??
                    ''
                  }
                />
              </label>

              <label>
                Résidence
                <input
                  name="residency"
                  defaultValue={
                    selected.residency ??
                    ''
                  }
                />
              </label>

              <label>
                Téléphone
                <input
                  name="phone"
                  defaultValue={
                    selected.phone ??
                    ''
                  }
                />
              </label>

              <label>
                Courriel
                <input
                  name="email"
                  type="email"
                  defaultValue={
                    selected.email ??
                    ''
                  }
                />
              </label>

              <label>
                Nouvelle photo
                <input
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                />
              </label>
            </div>

            <div className="actions">
              <button
                className="primary"
                disabled={
                  action.busy
                }
              >
                Enregistrer les
                modifications
              </button>

              <button
                type="button"
                className="secondary"
                disabled={
                  action.busy
                }
                onClick={
                  archiveClient
                }
              >
                Archiver
              </button>
            </div>
          </form>

          <section className="section client-verification-panel">
            <div className="section-title">
              <h2>Validation du compte ULC</h2>
              <span className="badge">{selected.account?.verificationStatus ?? 'AUCUN COMPTE PORTAIL'}</span>
            </div>
            {selected.account ? <>
              <p className="muted">Courriel {selected.account.emailVerifiedAt ? 'vérifié' : 'à vérifier'} · La validation ULC est indépendante de la vérification du courriel.</p>
              {selected.account.verificationStatus === 'PENDING' && currentUser?.permissions.includes('clients.verify') && <div className="actions"><button className="primary" disabled={action.busy} onClick={()=>void decideClientAccount('VERIFIED')}>Valider le compte</button><button className="danger" disabled={action.busy} onClick={()=>void decideClientAccount('REJECTED')}>Rejeter la demande</button></div>}
              {!selected.account.emailVerifiedAt&&currentUser?.permissions.includes('clients.create')&&<button className="secondary" disabled={action.busy} onClick={()=>void createPortalAccount()}>Envoyer ou renvoyer le lien d’activation</button>}
              {selected.account.verificationStatus === 'PENDING' && !currentUser?.permissions.includes('clients.verify') && <p className="muted">Votre rôle ne permet pas de valider les comptes. Demandez la permission « clients.verify » à un administrateur habilité.</p>}
              {selected.account.verificationStatus !== 'PENDING' && <p className="muted">{selected.account.verificationStatus === 'VERIFIED' ? 'Ce compte est vérifié.' : selected.account.verificationStatus === 'REJECTED' ? 'Cette demande a été rejetée.' : `État actuel : ${selected.account.verificationStatus}.`}</p>}
            </> : <><p className="muted">Aucun compte portail n’est associé à cette fiche. Un compte peut être créé avec le courriel enregistré, puis le client choisira son mot de passe depuis le lien d’activation envoyé. Si un compte existe déjà avec ce courriel, utilisez le rattachement sécurisé.</p>{selected.email&&currentUser?.permissions.includes('clients.create')&&<button className="primary" disabled={action.busy} onClick={()=>void createPortalAccount()}>Créer le compte portail pour {selected.email}</button>}{!selected.email&&<p className="muted">Ajoutez d’abord un courriel à cette fiche et enregistrez-la.</p>}{selected.email&&currentUser?.permissions.includes('clients.verify')&&<button className="secondary" disabled={action.busy} onClick={()=>void linkExistingAccount()}>Rattacher un compte déjà vérifié</button>}{!currentUser?.permissions.includes('clients.create')&&<p className="muted">Votre rôle ne permet pas de créer un compte portail.</p>}</>}
            {portalInviteLink&&<p className="muted">Lien de développement : <a href={portalInviteLink}>activer le compte portail</a></p>}
            {portalMessage&&<p className="muted" role="status">{portalMessage}</p>}
          </section>

          <div className="section">
            <div className="section-title">
              <h2>
                QR Code client
              </h2>

              <span className="badge">
                {activeQr
                  ? 'ACTIF'
                  : 'AUCUN QR ACTIF'}
              </span>
            </div>

            {!activeQr && (
              <button
                className="primary"
                disabled={
                  action.busy
                }
                onClick={
                  issueQr
                }
              >
                Émettre un QR Code
              </button>
            )}

            {activeQr && (
              <div className="actions">
                <button
                  className="primary"
                  disabled={
                    action.busy
                  }
                  onClick={
                    replaceQr
                  }
                >
                  Remplacer le QR
                </button>

                <button
                  className="secondary"
                  disabled={
                    action.busy
                  }
                  onClick={() =>
                    revokeQr(
                      activeQr.id,
                    )
                  }
                >
                  Révoquer
                </button>
              </div>
            )}
          </div>

          {generatedQrImage && (
            <section className="qr-print-card section">
              <p className="eyebrow">
                JAMI FOOD · ULC
              </p>

              <h2>
                {
                  selected.firstName
                }{' '}
                {
                  selected.lastName
                }
              </h2>

              <img
                className="qr-image"
                src={
                  generatedQrImage
                }
                alt="QR Code JAMI FOOD"
              />

              <p className="small muted">
                Présenter ce QR
                Code au contrôle
                des repas.
              </p>

              <p className="small">
                {
                  selected
                    .category
                    .label
                }
              </p>

              <div className="actions no-print">
                <button
                  className="secondary"
                  onClick={
                    downloadQr
                  }
                >
                  Télécharger PNG
                </button>

                <button
                  className="secondary"
                  onClick={
                    printQr
                  }
                >
                  Imprimer
                </button>

                <button
                  className="secondary"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      generatedToken,
                    )
                  }
                >
                  Copier le token
                  (DEMO)
                </button>
              </div>
            </section>
          )}

          <section className="section">
            <h3>
              Historique des QR
              Codes
            </h3>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      Émission
                    </th>
                    <th>
                      Statut
                    </th>
                    <th>
                      Révocation
                    </th>
                    <th>
                      Historique
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {selected.qrCodes.map(
                    (code) => (
                      <tr
                        key={
                          code.id
                        }
                      >
                        <td>
                          {date(
                            code.issuedAt,
                          )}
                        </td>

                        <td>
                          <span className="badge">
                            {
                              code.status
                            }
                          </span>
                        </td>

                        <td>
                          {code.revokedAt
                            ? date(
                                code.revokedAt,
                              )
                            : '—'}
                        </td>

                        <td>
                          {code.history
                            .map(
                              (
                                history,
                              ) =>
                                `${history.action} · ${date(history.createdAt)}`,
                            )
                            .join(
                              ' | ',
                            ) ||
                            '—'}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}
    </>
  );
}
