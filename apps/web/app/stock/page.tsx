'use client';

import { FormEvent, useState } from 'react';
import { api, date, money } from '../../lib/api';
import {
  Feedback,
  Field,
  formValues,
  Heading,
  Loading,
  useAction,
  useData,
} from '../../components/common';
import { useUser } from '../../components/shell';

type Item = {
  id: string;
  code: string;
  name: string;
  unit: string;
  quantity: string;
  alertThreshold: string;
};

type Purchase = {
  id: string;

  supplier: {
    name: string;
  };

  reference: string | null;

  amount: string;
  paidAmount: string;
  currency: string;
  createdAt: string;

  lines: {
    id: string;
    orderedQuantity: string;
    receivedQuantity: string;
    unit: string;

    stockItem: {
      id: string;
      code: string;
      name: string;
      unit: string;
    };
  }[];
};
type Recipe = {
  id: string;
  name: string;
  versions: {
    id: string;
    validated: boolean;
    yieldQuantity: string;
  }[];
};

type Lot = {
  id: string;
  batchNumber: string;
  quantity: string;
  expiresAt: string | null;
  receivedAt: string;
  stockItem: {
    id: string;
    code: string;
    name: string;
    unit: string;
  };
};

type Inventory = {
  id: string;
  stockItemId: string;
  counted: string;
  expected: string;
  reason: string;
  status: string;
};

type Movement = {
  id: string;
  stockItem: {
    name: string;
    unit: string;
  };
  delta: string;
  type: string;
  reason: string;
  occurredAt: string;
};

function lotStatus(expiresAt: string | null) {
  if (!expiresAt) {
    return 'Sans péremption';
  }

  const today = new Date();
  const expiration = new Date(expiresAt);
  const days = Math.ceil((expiration.getTime() - today.getTime()) / 86400000);

  if (days < 0) {
    return 'Expiré';
  }

  if (days === 0) {
    return "Expire aujourd’hui";
  }

  if (days <= 7) {
    return `Expire dans ${days} j`;
  }

  return 'Valide';
}

export default function Stock() {
  const [tab, setTab] = useState('Stock');

  const items = useData<Item[]>('/stock');
  const lots = useData<Lot[]>('/stock/lots');
  const suppliers = useData<{ id: string; name: string }[]>('/stock/suppliers');
  const purchases = useData<Purchase[]>('/stock/purchases');
  const recipes = useData<Recipe[]>('/stock/recipes');
  const inventories = useData<Inventory[]>('/stock/inventories');
  const movements = useData<Movement[]>('/stock/movements');
  const session = useData<{ id: string } | null>('/cash');

  const action = useAction();
  const user = useUser();
  const canAdjust = user?.permissions.includes('stock.adjust');

  const itemOptions = items.data?.map((item) => (
    <option key={item.id} value={item.id}>
      {item.name} ({item.unit})
    </option>
  ));

  const submit = (
    event: FormEvent<HTMLFormElement>,
    path: string,
    map?: (values: Record<string, string>) => unknown,
  ) => {
    event.preventDefault();

    const form = event.currentTarget;
    const values = formValues(form);

    action.run(async () => {
      await api(path, map ? map(values) : values);
      form.reset();
    });
  };

  return (
    <>
      <Heading
        title="Stocks & approvisionnements"
        subtitle="Des quantités traçables, de la réception à la production."
      />

      <Feedback {...action} />

      <div className="tabs">
        {[
          'Stock',
          'Lots & péremptions',
          'Mouvements',
          'Inventaires',
          'Achats',
          'Production',
        ].map((name) => (
          <button
            key={name}
            className={name === tab ? 'primary' : 'secondary'}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      <Loading loading={items.isLoading} error={items.error} />

      {tab === 'Stock' && (
        <>
          <section className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Code</th>
                  <th>Disponible</th>
                  <th>Seuil d’alerte</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {items.data?.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td>{item.code}</td>
                    <td>
                      {item.quantity} {item.unit}
                    </td>
                    <td>
                      {item.alertThreshold} {item.unit}
                    </td>
                    <td>
                      <span className="badge">
                        {Number(item.quantity) <= Number(item.alertThreshold)
                          ? 'À réapprovisionner'
                          : 'Disponible'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {canAdjust && (
            <div className="two-columns section">
              <form className="card" onSubmit={(event) => submit(event, '/stock')}>
                <h2>Nouvel article</h2>

                <div className="form-grid">
                  <Field label="Code unique" name="code" />
                  <Field label="Désignation" name="name" />
                </div>

                <label>
                  Unité de base
                  <select name="unit">
                    <option value="kg">Kilogramme</option>
                    <option value="litre">Litre</option>
                    <option value="pièce">Pièce</option>
                  </select>
                </label>

                <Field
                  label="Seuil d’alerte"
                  name="alertThreshold"
                  type="number"
                  defaultValue="5"
                />

                <button className="primary" disabled={action.busy}>
                  Créer l’article
                </button>
              </form>

              <form
                className="card"
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = formValues(event.currentTarget);

                  action.run(() =>
                    api(`/stock/${values.stockItemId}/movements`, {
                      quantity: values.quantity,
                      type: values.type,
                      reason: values.reason,
                    }),
                  );
                }}
              >
                <h2>Enregistrer un mouvement</h2>

                <label>
                  Article
                  <select name="stockItemId" required>
                    {itemOptions}
                  </select>
                </label>

                <div className="form-grid">
                  <label>
                    Nature
                    <select name="type">
                      <option value="INITIAL">Stock initial</option>
                      <option value="RETURN">Retour physique</option>
                      <option value="LOSS">Perte</option>
                      <option value="OUT">Sortie autorisée</option>
                    </select>
                  </label>

                  <Field
                    label="Quantité en unité de base"
                    name="quantity"
                    type="number"
                  />
                </div>

                <Field label="Motif (5 caractères minimum)" name="reason" />

                <button className="primary" disabled={action.busy}>
                  Enregistrer le mouvement
                </button>
              </form>
            </div>
          )}
        </>
      )}

      {tab === 'Lots & péremptions' && (
        <section className="card table-wrap">
          <h2>Lots & péremptions</h2>

          <Loading loading={lots.isLoading} error={lots.error} />

          <table>
            <thead>
              <tr>
                <th>Article</th>
                <th>Lot</th>
                <th>Quantité</th>
                <th>Réception</th>
                <th>Péremption</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {lots.data?.map((lot) => (
                <tr key={lot.id}>
                  <td>
                    <strong>{lot.stockItem.name}</strong>
                    <br />
                    <small>{lot.stockItem.code}</small>
                  </td>
                  <td>{lot.batchNumber}</td>
                  <td>
                    {lot.quantity} {lot.stockItem.unit}
                  </td>
                  <td>{date(lot.receivedAt)}</td>
                  <td>
                    {lot.expiresAt
                      ? new Date(lot.expiresAt).toLocaleDateString('fr-FR', {
                          timeZone: 'Africa/Kinshasa',
                        })
                      : '—'}
                  </td>
                  <td>
                    <span className="badge">{lotStatus(lot.expiresAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!lots.isLoading && !lots.data?.length && (
            <p className="empty">Aucun lot actif enregistré.</p>
          )}
        </section>
      )}

      {tab === 'Mouvements' && (
        <section className="card table-wrap">
          <h2>Journal des mouvements</h2>

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Article</th>
                <th>Variation</th>
                <th>Nature</th>
                <th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {movements.data?.map((movement) => (
                <tr key={movement.id}>
                  <td>{date(movement.occurredAt)}</td>
                  <td>{movement.stockItem.name}</td>
                  <td>
                    {movement.delta} {movement.stockItem.unit}
                  </td>
                  <td>{movement.type}</td>
                  <td>{movement.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'Inventaires' && (
        <div className="two-columns">
          <form
            className="card"
            onSubmit={(event) => submit(event, '/stock/inventories')}
          >
            <h2>Comptage physique</h2>

            <label>
              Article
              <select name="stockItemId">{itemOptions}</select>
            </label>

            <Field
              label="Quantité comptée (unité de base)"
              name="counted"
              type="number"
            />
            <Field label="Justification" name="reason" />

            <button className="primary" disabled={action.busy}>
              Soumettre le comptage
            </button>
          </form>

          <section className="card">
            <h2>Inventaires à contrôler</h2>

            {inventories.data?.map((inventory) => (
              <div className="item" key={inventory.id}>
                <span>
                  <strong>
                    {items.data?.find((item) => item.id === inventory.stockItemId)?.name}
                  </strong>
                  <br />
                  Théorique {inventory.expected} · Compté {inventory.counted}
                  <br />
                  <small>{inventory.reason}</small>
                </span>

                {inventory.status === 'PENDING' && canAdjust ? (
                  <button
                    className="secondary"
                    disabled={action.busy}
                    onClick={() =>
                      action.run(() =>
                        api(`/stock/inventories/${inventory.id}/validate`, {}),
                      )
                    }
                  >
                    Valider l’écart
                  </button>
                ) : (
                  <span className="badge">{inventory.status}</span>
                )}
              </div>
            ))}
          </section>
        </div>
      )}

      {tab === 'Achats' && (
        <>
          <section className="card table-wrap">
  <h2>Achats et dettes fournisseurs</h2>

  <table>
    <thead>
      <tr>
        <th>Fournisseur</th>
        <th>Article</th>
        <th>Réception</th>
        <th>Montant</th>
        <th>Dette</th>
        <th>État</th>
      </tr>
    </thead>

    <tbody>
      {purchases.data?.flatMap(
        purchase =>
          purchase.lines.map(line => {
            const ordered =
              Number(
                line.orderedQuantity,
              );

            const received =
              Number(
                line.receivedQuantity,
              );

            const remaining =
              Math.max(
                0,
                ordered - received,
              );

            const complete =
              received >= ordered;

            const partial =
              received > 0 &&
              !complete;

            const debt =
              Math.max(
                0,
                Number(
                  purchase.amount,
                ) -
                  Number(
                    purchase.paidAmount,
                  ),
              );

            return (
              <tr
                key={`${purchase.id}-${line.id}`}
              >
                <td>
                  <strong>
                    {
                      purchase
                        .supplier
                        .name
                    }
                  </strong>

                  <br />

                  <small>
                    {date(
                      purchase.createdAt,
                    )}
                  </small>

                  {purchase.reference && (
                    <>
                      <br />
                      <small>
                        Réf.{' '}
                        {
                          purchase.reference
                        }
                      </small>
                    </>
                  )}
                </td>

                <td>
                  <strong>
                    {
                      line.stockItem
                        .name
                    }
                  </strong>

                  <br />

                  <small>
                    {
                      line.stockItem
                        .code
                    }
                  </small>
                </td>

                <td>
                  Commandé :{' '}
                  <strong>
                    {
                      line.orderedQuantity
                    }{' '}
                    {line.unit}
                  </strong>

                  <br />

                  Reçu :{' '}
                  <strong>
                    {
                      line.receivedQuantity
                    }{' '}
                    {line.unit}
                  </strong>

                  <br />

                  Restant :{' '}
                  <strong>
                    {remaining}{' '}
                    {line.unit}
                  </strong>
                </td>

                <td>
                  {money(
                    purchase.amount,
                    purchase.currency,
                  )}

                  <br />

                  <small>
                    Réglé :{' '}
                    {money(
                      purchase.paidAmount,
                      purchase.currency,
                    )}
                  </small>
                </td>

                <td>
                  <strong>
                    {money(
                      debt,
                      purchase.currency,
                    )}
                  </strong>
                </td>

                <td>
                  <span className="badge">
                    {complete
                      ? 'Réception complète'
                      : partial
                        ? 'Réception partielle'
                        : 'En attente'}
                  </span>

                  <br />

                  <span className="badge">
                    {debt <= 0
                      ? 'Payé'
                      : Number(
                            purchase.paidAmount,
                          ) > 0
                        ? 'Paiement partiel'
                        : 'Non payé'}
                  </span>
                </td>
              </tr>
            );
          }),
      )}
    </tbody>
  </table>

  {!purchases.isLoading &&
    !purchases.data?.length && (
      <p className="empty">
        Aucun achat enregistré.
      </p>
    )}
</section>

          {canAdjust && (
            <div className="two-columns section">
              <form
                className="card"
                onSubmit={(event) =>
                  submit(event, '/stock/suppliers', (values) => ({
                    name: values.name,
                    ...(values.phone ? { phone: values.phone } : {}),
                  }))
                }
              >
                <h2>Nouveau fournisseur</h2>
                <Field label="Nom" name="name" />
                <Field label="Téléphone" name="phone" required={false} />

                <button className="primary" disabled={action.busy}>
                  Créer le fournisseur
                </button>
              </form>

              <form
  className="card"
  onSubmit={e =>
    submit(
      e,
      '/stock/purchases',
      v => ({
        supplierId:
          v.supplierId,

        ...(v.reference
          ? {
              reference:
                v.reference,
            }
          : {}),

        ...(v.invoiceNumber
          ? {
              invoiceNumber:
                v.invoiceNumber,
            }
          : {}),

        ...(v.invoiceDate
          ? {
              invoiceDate:
                v.invoiceDate,
            }
          : {}),

        amount:
          v.amount,

        currency:
          v.currency,

        lines: [
          {
            stockItemId:
              v.stockItemId,

            orderedQuantity:
              v.orderedQuantity,
          },
        ],
      }),
    )
  }
>
  <h2>
    Enregistrer un achat
  </h2>

  <label>
    Fournisseur

    <select
      required
      name="supplierId"
    >
      {suppliers.data?.map(
        s => (
          <option
            key={s.id}
            value={s.id}
          >
            {s.name}
          </option>
        ),
      )}
    </select>
  </label>

  <label>
    Article commandé

    <select
      required
      name="stockItemId"
    >
      {itemOptions}
    </select>
  </label>

  <Field
    label="Quantité commandée"
    name="orderedQuantity"
    type="number"
  />

  <div className="form-grid">
    <Field
      label="Référence achat"
      name="reference"
      required={false}
    />

    <Field
      label="N° facture"
      name="invoiceNumber"
      required={false}
    />

    <Field
      label="Date facture"
      name="invoiceDate"
      type="date"
      required={false}
    />
  </div>

  <div className="form-grid">
    <Field
      label="Montant total"
      name="amount"
      type="number"
    />

    <label>
      Devise

      <select name="currency">
        <option value="CDF">
          CDF
        </option>

        <option value="USD">
          USD
        </option>
      </select>
    </label>
  </div>

  <button
    className="primary"
    disabled={action.busy}
  >
    Enregistrer l’achat
  </button>
</form>

              <form
                className="card"
                onSubmit={(event) =>
                  submit(event, '/stock/receipts', (values) => ({
                    purchaseId: values.purchaseId,
                    reference: values.reference,
                    lines: [
                      {
                        stockItemId: values.stockItemId,
                        quantity: values.quantity,
                        unit: items.data?.find(
                          (item) => item.id === values.stockItemId,
                        )?.unit,
                        ...(values.batchNumber
                          ? { batchNumber: values.batchNumber }
                          : {}),
                        ...(values.expiresAt ? { expiresAt: values.expiresAt } : {}),
                      },
                    ],
                  }))
                }
              >
                <h2>Réception physique</h2>

                <label>
                  Achat
                  <select name="purchaseId" required>
                    {purchases.data?.map((purchase) => (
                      <option key={purchase.id} value={purchase.id}>
                        {purchase.supplier.name} ·{' '}
                        {money(purchase.amount, purchase.currency)}
                      </option>
                    ))}
                  </select>
                </label>

                <Field
                  label="Référence du bon de livraison"
                  name="reference"
                />

                <label>
                  Article reçu
                  <select name="stockItemId" required>
                    {itemOptions}
                  </select>
                </label>

                <Field label="Quantité reçue" name="quantity" type="number" />

                <div className="form-grid">
                  <Field
                    label="Numéro de lot"
                    name="batchNumber"
                    required={false}
                  />
                  <Field
                    label="Date de péremption"
                    name="expiresAt"
                    type="date"
                    required={false}
                  />
                </div>

                <p className="muted small">
                  Pour une denrée périssable, renseignez le numéro de lot et la date de
                  péremption.
                </p>

                <button className="primary" disabled={action.busy}>
                  Réceptionner
                </button>
              </form>

              {user?.permissions.includes('cash.expense') && (
                <form
                  className="card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const values = formValues(event.currentTarget);

                    action.run(() =>
                      api(`/stock/purchases/${values.purchaseId}/payments`, {
                        cashSessionId: session.data?.id,
                        amount: values.amount,
                      }),
                    );
                  }}
                >
                  <h2>Régler un fournisseur</h2>

                  <label>
                    Achat
                    <select name="purchaseId">
                      {purchases.data?.map((purchase) => (
                        <option key={purchase.id} value={purchase.id}>
                          {purchase.supplier.name} · {purchase.currency}
                        </option>
                      ))}
                    </select>
                  </label>

                  <Field
                    label="Montant dans la devise de l’achat"
                    name="amount"
                    type="number"
                  />

                  <p className="muted small">
                    Ce règlement crée une sortie de caisse. Il n’ajoute aucun stock et ne
                    crée pas une deuxième dépense.
                  </p>

                  <button
                    className="primary"
                    disabled={action.busy || !session.data}
                  >
                    Enregistrer le règlement
                  </button>
                </form>
              )}
            </div>
          )}
        </>
      )}

      {tab === 'Production' && (
        <>
          <section className="card">
            <h2>Recettes et versions</h2>

            {recipes.data?.map((recipe) => (
              <div className="item" key={recipe.id}>
                <span>
                  <strong>{recipe.name}</strong>
                  <br />
                  Rendement : {recipe.versions[0]?.yieldQuantity} portions
                </span>

                {recipe.versions[0]?.validated ? (
                  <span className="badge">Validée</span>
                ) : (
                  canAdjust && (
                    <button
                      className="secondary"
                      disabled={action.busy}
                      onClick={() =>
                        action.run(() =>
                          api(`/stock/recipes/${recipe.versions[0].id}/validate`, {}),
                        )
                      }
                    >
                      Valider la recette
                    </button>
                  )
                )}
              </div>
            ))}
          </section>

          {canAdjust && (
            <div className="two-columns section">
              <form
                className="card"
                onSubmit={(event) =>
                  submit(event, '/stock/recipes', (values) => ({
                    name: values.name,
                    yieldQuantity: values.yieldQuantity,
                    ingredients: [
                      {
                        stockItemId: values.stockItemId,
                        quantity: values.quantity,
                      },
                    ],
                  }))
                }
              >
                <h2>Créer une recette simple</h2>

                <Field label="Nom de la recette" name="name" />
                <Field
                  label="Rendement (portions)"
                  name="yieldQuantity"
                  type="number"
                />

                <label>
                  Ingrédient principal
                  <select name="stockItemId">{itemOptions}</select>
                </label>

                <Field
                  label="Quantité d’ingrédient par lot (unité de base)"
                  name="quantity"
                  type="number"
                />

                <button className="primary" disabled={action.busy}>
                  Créer pour validation
                </button>
              </form>

              <form
                className="card"
                onSubmit={(event) => submit(event, '/stock/productions')}
              >
                <h2>Valider une production</h2>

                <label>
                  Recette validée
                  <select name="recipeVersionId">
                    {recipes.data?.flatMap((recipe) =>
                      recipe.versions
                        .filter((version) => version.validated)
                        .map((version) => (
                          <option key={version.id} value={version.id}>
                            {recipe.name}
                          </option>
                        )),
                    )}
                  </select>
                </label>

                <Field
                  label="Nombre de portions produites"
                  name="quantity"
                  type="number"
                />

                <p className="muted small">
                  Les ingrédients sont déduits à cette étape, une seule fois. Le service du
                  repas ne les déduira pas à nouveau.
                </p>

                <button className="primary" disabled={action.busy}>
                  Valider et déduire les ingrédients
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </>
  );
}

