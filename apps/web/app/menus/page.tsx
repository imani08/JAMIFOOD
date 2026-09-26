'use client';

import { useState } from 'react';

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

type Product = {
  id: string;
  name: string;
  sku: string | null;
  imageUrl: string;
  active: boolean;
  available: boolean;
};

type MenuItem = {
  id: string;
  productId: string;
  quantityAvailable: number;
  quantitySold: number;
  available: boolean;
  position: number;
  variants: string[] | null;

  product: Product;
};

type MenuVersion = {
  id: string;
  version: number;
  status:
    | 'DRAFT'
    | 'PUBLISHED'
    | 'RETIRED';

  notes: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  items: MenuItem[];
};

type Menu = {
  id: string;
  businessDate: string;
  serviceCode: string;
  versions: MenuVersion[];
};

function kinshasaToday() {
  const parts =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          'Africa/Kinshasa',

        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      },
    ).formatToParts(
      new Date(),
    );

  const get = (
    type: string,
  ) =>
    parts.find(
      (part) =>
        part.type === type,
    )?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function serviceLabel(
  code: string,
) {
  if (
    code === 'BREAKFAST'
  ) {
    return 'Petit-déjeuner';
  }

  if (code === 'LUNCH') {
    return 'Déjeuner';
  }

  if (code === 'DINNER') {
    return 'Dîner';
  }

  return code;
}

function VersionEditor({
  version,
  products,
}: {
  version: MenuVersion;
  products: Product[];
}) {
  const action = useAction();

  const [productId, setProductId] =
    useState('');

  const [
    quantityAvailable,
    setQuantityAvailable,
  ] = useState('20');

  const [
    variants,
    setVariants,
  ] = useState('');

  const [
    duplicateDate,
    setDuplicateDate,
  ] = useState('');

  const [
    duplicateService,
    setDuplicateService,
  ] = useState('LUNCH');

  async function addItem(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!productId) {
      return;
    }

    const result =
      await action.run(
        () =>
          api(
            `/menus/versions/${version.id}/items`,
            {
              productId,

              quantityAvailable:
                Number(
                  quantityAvailable,
                ),

              variants:
                variants
                  .split(',')
                  .map(
                    (value) =>
                      value.trim(),
                  )
                  .filter(Boolean),

              position:
                version.items.length,
            },
          ),

        'Article enregistré dans le menu.',
      );

    if (result) {
      setProductId('');
      setQuantityAvailable(
        '20',
      );
      setVariants('');
    }
  }

  async function publish() {
    if (
      !window.confirm(
        'Publier cette version du menu ? L’ancienne version publiée sera conservée dans l’historique.',
      )
    ) {
      return;
    }

    await action.run(
      () =>
        api(
          `/menus/versions/${version.id}/publish`,
          {},
        ),

      'Menu publié.',
    );
  }

  async function duplicate(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!duplicateDate) {
      return;
    }

    await action.run(
      () =>
        api(
          `/menus/versions/${version.id}/duplicate`,
          {
            businessDate:
              duplicateDate,

            serviceCode:
              duplicateService,
          },
        ),

      'Menu dupliqué en nouveau brouillon.',
    );
  }

  return (
    <section className="card section">
      <div className="page-heading">
        <div>
          <h2>
            Version {version.version}
          </h2>

          <p className="muted">
            {version.notes ??
              'Aucune note'}
          </p>
        </div>

        <span className="badge">
          {version.status}
        </span>
      </div>

      <Feedback
        error={action.error}
        notice={action.notice}
      />

      {version.publishedAt && (
        <p className="muted small">
          Publié le{' '}
          {date(
            version.publishedAt,
          )}
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Produit</th>
              <th>Variantes</th>
              <th>Prévu</th>
              <th>Vendu</th>
              <th>Restant</th>
              <th>État</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {version.items.map(
              (item) => {
                const remaining =
                  Math.max(
                    0,
                    item.quantityAvailable -
                      item.quantitySold,
                  );

                return (
                  <tr
                    key={item.id}
                  >
                    <td>
                      <strong>
                        {
                          item.product
                            .name
                        }
                      </strong>

                      <br />

                      <small className="muted">
                        {
                          item.product
                            .sku
                        }
                      </small>
                    </td>

                    <td>
                      {Array.isArray(
                        item.variants,
                      )
                        ? item.variants.join(
                            ', ',
                          )
                        : '—'}
                    </td>

                    <td>
                      {
                        item.quantityAvailable
                      }
                    </td>

                    <td>
                      {
                        item.quantitySold
                      }
                    </td>

                    <td>
                      {remaining}
                    </td>

                    <td>
                      <span className="badge">
                        {item.available &&
                        remaining > 0
                          ? 'DISPONIBLE'
                          : 'ÉPUISÉ'}
                      </span>
                    </td>

                    <td>
                      <button
                        className="secondary"
                        disabled={
                          action.busy
                        }
                        onClick={() =>
                          action.run(
                            () =>
                              api(
                                `/menus/items/${item.id}/availability`,
                                {
                                  available:
                                    !item.available,
                                },
                              ),

                            item.available
                              ? 'Produit retiré du menu.'
                              : 'Produit remis en vente.',
                          )
                        }
                      >
                        {item.available
                          ? 'Marquer épuisé'
                          : 'Remettre disponible'}
                      </button>
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>

        {!version.items.length && (
          <p className="empty">
            Aucun article dans
            cette version.
          </p>
        )}
      </div>

      {version.status ===
        'DRAFT' && (
        <form
          className="section"
          onSubmit={addItem}
        >
          <h3>
            Ajouter un produit
          </h3>

          <div className="form-grid">
            <label>
              Produit
              <select
                value={productId}
                onChange={(event) =>
                  setProductId(
                    event.target
                      .value,
                  )
                }
                required
              >
                <option value="">
                  Choisir…
                </option>

                {products
                  .filter(
                    (product) =>
                      product.active,
                  )
                  .map(
                    (product) => (
                      <option
                        key={
                          product.id
                        }
                        value={
                          product.id
                        }
                      >
                        {
                          product.name
                        }
                      </option>
                    ),
                  )}
              </select>
            </label>

            <label>
              Quantité disponible
              <input
                type="number"
                min="0"
                step="1"
                value={
                  quantityAvailable
                }
                onChange={(event) =>
                  setQuantityAvailable(
                    event.target
                      .value,
                  )
                }
                required
              />
            </label>
          </div>

          <label>
            Variantes
            <input
              value={variants}
              onChange={(event) =>
                setVariants(
                  event.target.value,
                )
              }
              placeholder="Riz, Frites, Plantain"
            />

            <small className="muted">
              Sépare les variantes
              par des virgules.
            </small>
          </label>

          <div className="actions">
            <button
              className="primary"
              disabled={
                action.busy
              }
            >
              Ajouter / mettre à jour
            </button>

            <button
              type="button"
              className="secondary"
              disabled={
                action.busy ||
                !version.items.length
              }
              onClick={
                publish
              }
            >
              Publier ce menu
            </button>
          </div>
        </form>
      )}

      <form
        className="section"
        onSubmit={duplicate}
      >
        <h3>
          Dupliquer ce menu
        </h3>

        <div className="form-grid">
          <label>
            Nouvelle date
            <input
              type="date"
              value={
                duplicateDate
              }
              onChange={(event) =>
                setDuplicateDate(
                  event.target
                    .value,
                )
              }
              required
            />
          </label>

          <label>
            Service
            <select
              value={
                duplicateService
              }
              onChange={(event) =>
                setDuplicateService(
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

        <button
          className="secondary"
          disabled={action.busy}
        >
          Dupliquer
        </button>
      </form>
    </section>
  );
}

export default function Menus() {
  const [selectedDate, setSelectedDate] =
    useState(
      kinshasaToday(),
    );
  const [menuImage, setMenuImage] =
  useState<File | null>(null);

  const action = useAction();

  const menus =
    useData<Menu[]>(
      `/menus?date=${selectedDate}`,
    );

  const products =
    useData<Product[]>(
      '/commercial/products?limit=100&state=ACTIVE',
    );

  const [serviceCode, setServiceCode] =
    useState('LUNCH');

  const [notes, setNotes] =
    useState('');

  async function createDraft(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const result =
      await action.run(
        () =>
          api('/menus', {
            businessDate:
              selectedDate,

            serviceCode,

            notes,
          }),

        'Brouillon créé.',
      );

    if (result) {
      setNotes('');
    }
  }

  return (
    <>
      <Heading
        title="Menus"
        subtitle="Préparez et publiez les menus par date et service sans réécrire l’historique."
      />

      <Feedback
        error={action.error}
        notice={action.notice}
      />

      <div className="two-columns">
        <section className="card">
          <h2>
            Journée à gérer
          </h2>

          <label>
            Date
            <input
              type="date"
              value={
                selectedDate
              }
              onChange={(event) =>
                setSelectedDate(
                  event.target
                    .value,
                )
              }
            />
          </label>

          <p className="muted">
            Les trois services
            peuvent disposer de
            menus différents.
          </p>
        </section>

        <form
          className="card"
          onSubmit={createDraft}
        >
          <h2>
            Nouveau brouillon
          </h2>

          <label>
            Service
            <select
              value={serviceCode}
              onChange={(event) =>
                setServiceCode(
                  event.target.value,
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

          <label>
            Note
            <textarea
              value={notes}
              onChange={(event) =>
                setNotes(
                  event.target.value,
                )
              }
              placeholder="Ex. Menu spécial vendredi"
            />
          </label>
          <label>
  Image du menu
  <input
    type="file"
    accept="image/jpeg,image/png,image/webp"
    onChange={(event) =>
      setMenuImage(
        event.target.files?.[0] ?? null,
      )
    }
  />

  <small className="muted">
    Facultatif · JPG, PNG ou WEBP
  </small>
</label>

          <button
            className="primary"
            disabled={action.busy}
          >
            Créer le brouillon
          </button>
        </form>
      </div>

      <Loading
        loading={menus.isLoading}
        error={menus.error}
      />

      {menus.data?.map(
        (menu) => (
          <section
            key={menu.id}
            className="section"
          >
            <div className="section-title">
              <h2>
                {serviceLabel(
                  menu.serviceCode,
                )}
              </h2>

              <span className="badge">
                {selectedDate}
              </span>
            </div>

            {menu.versions.map(
              (version) => (
                <VersionEditor
                  key={version.id}
                  version={
                    version
                  }
                  products={
                    products.data ??
                    []
                  }
                />
              ),
            )}
          </section>
        ),
      )}

      {!menus.isLoading &&
        !menus.data?.length && (
          <p className="empty">
            Aucun menu pour cette
            date.
          </p>
        )}
    </>
  );
}