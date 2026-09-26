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
  Loading,
  useAction,
  useData,
} from '../../components/common';

type ProductCategory = {
  id: string;
  code: string;
  label: string;
  active: boolean;
};

type ClientCategory = {
  id: string;
  code: string;
  label: string;
  active: boolean;
};

type PriceVersion = {
  id: string;
  version: number;
  amount: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  effectiveStatus: string;
  createdAt: string;
};

type ProductPrice = {
  id: string;
  categoryCode: string;
  versions: PriceVersion[];
};

type Product = {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  saleUnit: string;
  baseComposition: string | null;
  optionsDescription: string | null;
  variantsDescription: string | null;
  available: boolean;
  active: boolean;
  categoryId: string;
  category: ProductCategory;
  prices: ProductPrice[];
};

function ProductEditor({
  product,
  categories,
  clientCategories,
}: {
  product: Product;
  categories: ProductCategory[];
  clientCategories: ClientCategory[];
}) {
  const action = useAction();

  const [sku, setSku] =
    useState(product.sku ?? '');

  const [name, setName] =
    useState(product.name);

  const [categoryId, setCategoryId] =
    useState(product.categoryId);

  const [description, setDescription] =
    useState(product.description ?? '');

  const [saleUnit, setSaleUnit] =
    useState(product.saleUnit);

  const [
    baseComposition,
    setBaseComposition,
  ] = useState(
    product.baseComposition ?? '',
  );

  const [
    optionsDescription,
    setOptionsDescription,
  ] = useState(
    product.optionsDescription ?? '',
  );

  const [
    variantsDescription,
    setVariantsDescription,
  ] = useState(
    product.variantsDescription ?? '',
  );

  const [
    priceCategory,
    setPriceCategory,
  ] = useState(
    clientCategories.find(
      (category) => category.active,
    )?.code ?? '',
  );

  const [amount, setAmount] =
    useState('');

  const [currency, setCurrency] =
    useState('CDF');

  const [
    effectiveFrom,
    setEffectiveFrom,
  ] = useState('');

  async function saveProduct() {
    await action.run(
      () =>
        api(
          `/commercial/products/${product.id}`,
          {
            sku,
            name,
            categoryId,
            description,
            saleUnit,
            baseComposition,
            optionsDescription,
            variantsDescription,
          },
        ),
      'Produit modifié.',
    );
  }

  async function toggleActive() {
    await action.run(
      () =>
        api(
          `/commercial/products/${product.id}/state`,
          {
            active: !product.active,
          },
        ),
      product.active
        ? 'Produit désactivé.'
        : 'Produit réactivé.',
    );
  }

  async function toggleAvailability() {
    await action.run(
      () =>
        api(
          `/commercial/products/${product.id}/state`,
          {
            available:
              !product.available,
          },
        ),
      product.available
        ? 'Produit marqué indisponible.'
        : 'Produit de nouveau disponible.',
    );
  }

  async function addPrice(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !priceCategory ||
      !amount ||
      !effectiveFrom
    ) {
      return;
    }

    await action.run(
      () =>
        api(
          `/commercial/products/${product.id}/prices`,
          {
            categoryCode:
              priceCategory,
            amount,
            currency,
            effectiveFrom: new Date(
              effectiveFrom,
            ).toISOString(),
          },
        ),
      'Nouvelle version tarifaire enregistrée.',
    );

    setAmount('');
    setEffectiveFrom('');
  }

  return (
    <details className="card section">
      <summary>
        <strong>{product.name}</strong>
        {' · '}
        {product.sku}
        {' · '}
        <span className="badge">
          {product.category.label}
        </span>
        {' '}
        <span className="badge">
          {product.active
            ? 'ACTIF'
            : 'INACTIF'}
        </span>
        {' '}
        <span className="badge">
          {product.available
            ? 'DISPONIBLE'
            : 'INDISPONIBLE'}
        </span>
      </summary>

      <Feedback
        error={action.error}
        notice={action.notice}
      />

      <div className="two-columns section">
        <section>
          <h3>Fiche produit</h3>

          <div className="form-grid">
            <label>
              Code / SKU
              <input
                value={sku}
                onChange={(event) =>
                  setSku(
                    event.target.value,
                  )
                }
              />
            </label>

            <label>
              Nom
              <input
                value={name}
                onChange={(event) =>
                  setName(
                    event.target.value,
                  )
                }
              />
            </label>

            <label>
              Catégorie
              <select
                value={categoryId}
                onChange={(event) =>
                  setCategoryId(
                    event.target.value,
                  )
                }
              >
                {categories
                  .filter(
                    (category) =>
                      category.active ||
                      category.id ===
                        categoryId,
                  )
                  .map((category) => (
                    <option
                      key={category.id}
                      value={category.id}
                    >
                      {category.label}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Unité de vente
              <input
                value={saleUnit}
                onChange={(event) =>
                  setSaleUnit(
                    event.target.value,
                  )
                }
                placeholder="portion, bouteille, pièce..."
              />
            </label>
          </div>

          <label>
            Description
            <textarea
              value={description}
              onChange={(event) =>
                setDescription(
                  event.target.value,
                )
              }
            />
          </label>

          <label>
            Composition de base
            <textarea
              value={baseComposition}
              onChange={(event) =>
                setBaseComposition(
                  event.target.value,
                )
              }
              placeholder="Ex. riz, viande, légumes..."
            />
          </label>

          <label>
            Options facturables / informations
            <textarea
              value={optionsDescription}
              onChange={(event) =>
                setOptionsDescription(
                  event.target.value,
                )
              }
            />
          </label>

          <label>
            Variantes
            <textarea
              value={variantsDescription}
              onChange={(event) =>
                setVariantsDescription(
                  event.target.value,
                )
              }
            />
          </label>

          <div className="actions">
            <button
              className="primary"
              onClick={saveProduct}
              disabled={action.busy}
            >
              Enregistrer
            </button>

            <button
              className="secondary"
              onClick={toggleAvailability}
              disabled={action.busy}
            >
              {product.available
                ? 'Marquer indisponible'
                : 'Rendre disponible'}
            </button>

            <button
              className="secondary"
              onClick={toggleActive}
              disabled={action.busy}
            >
              {product.active
                ? 'Désactiver'
                : 'Réactiver'}
            </button>
          </div>
        </section>

        <section>
          <h3>Nouveau tarif</h3>

          <form onSubmit={addPrice}>
            <label>
              Catégorie client
              <select
                value={priceCategory}
                onChange={(event) =>
                  setPriceCategory(
                    event.target.value,
                  )
                }
                required
              >
                <option value="">
                  Choisir…
                </option>

                {clientCategories
                  .filter(
                    (category) =>
                      category.active,
                  )
                  .map((category) => (
                    <option
                      key={category.id}
                      value={category.code}
                    >
                      {category.label}
                    </option>
                  ))}
              </select>
            </label>

            <div className="form-grid">
              <label>
                Montant
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) =>
                    setAmount(
                      event.target.value,
                    )
                  }
                  required
                />
              </label>

              <label>
                Devise
                <select
                  value={currency}
                  onChange={(event) =>
                    setCurrency(
                      event.target.value,
                    )
                  }
                >
                  <option value="CDF">
                    CDF
                  </option>
                  <option value="USD">
                    USD
                  </option>
                </select>
              </label>
            </div>

            <label>
              Prise d'effet
              <input
                type="datetime-local"
                value={effectiveFrom}
                onChange={(event) =>
                  setEffectiveFrom(
                    event.target.value,
                  )
                }
                required
              />
            </label>

            <button
              className="primary"
              disabled={action.busy}
            >
              Enregistrer le tarif
            </button>
          </form>

          <h3 className="section">
            Historique tarifaire
          </h3>

          {!product.prices.length && (
            <p className="empty">
              Aucun tarif enregistré.
            </p>
          )}

          {product.prices.map(
            (price) => (
              <div
                key={price.id}
                className="section"
              >
                <strong>
                  {
                    clientCategories.find(
                      (category) =>
                        category.code ===
                        price.categoryCode,
                    )?.label
                  ??
                    price.categoryCode
                  }
                </strong>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Prix</th>
                        <th>Prise d'effet</th>
                        <th>État</th>
                      </tr>
                    </thead>

                    <tbody>
                      {price.versions.map(
                        (version) => (
                          <tr
                            key={
                              version.id
                            }
                          >
                            <td>
                              v
                              {
                                version.version
                              }
                            </td>

                            <td>
                              {money(
                                version.amount,
                                version.currency,
                              )}
                            </td>

                            <td>
                              {date(
                                version.effectiveFrom,
                              )}
                            </td>

                            <td>
                              <span className="badge">
                                {
                                  version.effectiveStatus
                                }
                              </span>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          )}
        </section>
      </div>
    </details>
  );
}

export default function Products() {
  const products =
    useData<Product[]>(
      '/commercial/products?limit=100',
    );

  const categories =
    useData<ProductCategory[]>(
      '/commercial/product-categories',
    );

  const clientCategories =
    useData<ClientCategory[]>(
      '/commercial/client-categories',
    );

  const createAction = useAction();
  const categoryAction = useAction();
  const bulkAction = useAction();

  const [bulkProductId, setBulkProductId] =
    useState('');

  const [
    bulkEffectiveFrom,
    setBulkEffectiveFrom,
  ] = useState('');

  const [bulkCurrency, setBulkCurrency] =
    useState('CDF');

  const [bulkAmounts, setBulkAmounts] =
    useState<Record<string, string>>(
      {},
    );

  async function createProduct(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    const result =
      await createAction.run(
        () =>
          api('/commercial/products', {
            sku: String(
              data.get('sku') ?? '',
            ),
            name: String(
              data.get('name') ?? '',
            ),
            categoryId: String(
              data.get('categoryId') ??
                '',
            ),
            saleUnit: String(
              data.get('saleUnit') ??
                '',
            ),
            description: String(
              data.get('description') ??
                '',
            ),
            baseComposition: String(
              data.get(
                'baseComposition',
              ) ?? '',
            ),
            optionsDescription:
              String(
                data.get(
                  'optionsDescription',
                ) ?? '',
              ),
            variantsDescription:
              String(
                data.get(
                  'variantsDescription',
                ) ?? '',
              ),
          }),
        'Produit créé.',
      );

    if (result) {
      form.reset();
    }
  }

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
            '/commercial/product-categories',
            {
              code: String(
                data.get('code') ?? '',
              ),
              label: String(
                data.get('label') ?? '',
              ),
            },
          ),
        'Catégorie créée.',
      );

    if (result) {
      form.reset();
    }
  }

  async function submitBulkPrices(
    event:
      React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !bulkProductId ||
      !bulkEffectiveFrom
    ) {
      return;
    }

    const changes =
      clientCategories.data
        ?.filter(
          (category) =>
            category.active &&
            bulkAmounts[
              category.code
            ],
        )
        .map((category) => ({
          productId: bulkProductId,
          categoryCode:
            category.code,
          amount:
            bulkAmounts[
              category.code
            ],
          currency: bulkCurrency,
          effectiveFrom: new Date(
            bulkEffectiveFrom,
          ).toISOString(),
        })) ?? [];

    if (!changes.length) {
      window.alert(
        'Saisissez au moins un prix.',
      );
      return;
    }

    const result =
      await bulkAction.run(
        () =>
          api(
            '/commercial/prices/bulk',
            {
              changes,
            },
          ),
        `${changes.length} tarif(s) enregistré(s).`,
      );

    if (result) {
      setBulkAmounts({});
      setBulkEffectiveFrom('');
    }
  }

  return (
    <>
      <Heading
        title="Catalogue & tarifs"
        subtitle="Produits, disponibilité et historique des prix par catégorie de client."
      />

      <div className="two-columns">
        <form
          className="card"
          onSubmit={createProduct}
        >
          <h2>Nouveau produit</h2>

          <Feedback
            error={createAction.error}
            notice={
              createAction.notice
            }
          />

          <div className="form-grid">
            <label>
              Code / SKU
              <input
                name="sku"
                placeholder="REPAS-001"
                required
              />
            </label>

            <label>
              Nom
              <input
                name="name"
                required
              />
            </label>

            <label>
              Catégorie
              <select
                name="categoryId"
                required
              >
                <option value="">
                  Choisir…
                </option>

                {categories.data
                  ?.filter(
                    (category) =>
                      category.active,
                  )
                  .map((category) => (
                    <option
                      key={category.id}
                      value={category.id}
                    >
                      {category.label}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Unité de vente
              <input
                name="saleUnit"
                defaultValue="portion"
                required
              />
            </label>
          </div>

          <label>
            Description
            <textarea name="description" />
          </label>

          <label>
            Composition de base
            <textarea
              name="baseComposition"
              placeholder="Description du repas de base..."
            />
          </label>

          <label>
            Options facturables
            <textarea name="optionsDescription" />
          </label>

          <label>
            Variantes
            <textarea name="variantsDescription" />
          </label>

          <button
            className="primary"
            disabled={
              createAction.busy
            }
          >
            Créer le produit
          </button>
        </form>

        <form
          className="card"
          onSubmit={createCategory}
        >
          <h2>
            Catégories de produits
          </h2>

          <Feedback
            error={categoryAction.error}
            notice={
              categoryAction.notice
            }
          />

          {categories.data?.map(
            (category) => (
              <div
                className="item"
                key={category.id}
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

          <div className="section">
            <label>
              Code
              <input
                name="code"
                placeholder="BOISSON"
                required
              />
            </label>

            <label>
              Libellé
              <input
                name="label"
                placeholder="Boissons"
                required
              />
            </label>

            <button
              className="primary"
              disabled={
                categoryAction.busy
              }
            >
              Ajouter la catégorie
            </button>
          </div>
        </form>
      </div>

      <form
        className="card section"
        onSubmit={submitBulkPrices}
      >
        <h2>
          Modification groupée des prix
        </h2>

        <p className="muted">
          Permet d'enregistrer plusieurs
          tarifs dans une seule opération
          contrôlée.
        </p>

        <Feedback
          error={bulkAction.error}
          notice={bulkAction.notice}
        />

        <div className="form-grid">
          <label>
            Produit
            <select
              value={bulkProductId}
              onChange={(event) =>
                setBulkProductId(
                  event.target.value,
                )
              }
              required
            >
              <option value="">
                Choisir…
              </option>

              {products.data
                ?.filter(
                  (product) =>
                    product.active,
                )
                .map((product) => (
                  <option
                    key={product.id}
                    value={product.id}
                  >
                    {product.name}
                  </option>
                ))}
            </select>
          </label>

          <label>
            Devise
            <select
              value={bulkCurrency}
              onChange={(event) =>
                setBulkCurrency(
                  event.target.value,
                )
              }
            >
              <option value="CDF">
                CDF
              </option>
              <option value="USD">
                USD
              </option>
            </select>
          </label>
        </div>

        <label>
          Date de prise d'effet
          <input
            type="datetime-local"
            value={bulkEffectiveFrom}
            onChange={(event) =>
              setBulkEffectiveFrom(
                event.target.value,
              )
            }
            required
          />
        </label>

        <div className="grid">
          {clientCategories.data
            ?.filter(
              (category) =>
                category.active,
            )
            .map((category) => (
              <label
                key={category.id}
              >
                {category.label}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    bulkAmounts[
                      category.code
                    ] ?? ''
                  }
                  onChange={(event) =>
                    setBulkAmounts(
                      (current) => ({
                        ...current,
                        [category.code]:
                          event.target
                            .value,
                      }),
                    )
                  }
                  placeholder="Laisser vide si inchangé"
                />
              </label>
            ))}
        </div>

        <button
          className="primary"
          disabled={bulkAction.busy}
        >
          Enregistrer la grille
        </button>
      </form>

      <section className="section">
        <h2>Produits existants</h2>

        <Loading
          loading={products.isLoading}
          error={products.error}
        />

        {products.data?.map(
          (product) => (
            <ProductEditor
              key={product.id}
              product={product}
              categories={
                categories.data ?? []
              }
              clientCategories={
                clientCategories.data ??
                []
              }
            />
          ),
        )}

        {!products.data?.length &&
          !products.isLoading && (
            <p className="empty">
              Aucun produit.
            </p>
          )}
      </section>
    </>
  );
}