'use client';

import { useState } from 'react';

import {
  api,
  apiForm,
  apiDelete,
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
  quantityReserved: number;
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

function ProductOptionsEditor({ product, products }: { product: Product; products: Product[] }) {
  const action = useAction();
  const groups = useData<Array<{id:string;name:string;type:'VARIANT'|'SUPPLEMENT';required:boolean;minSelections:number;maxSelections:number;active:boolean}>>(`/menus/products/${product.id}/option-groups`);
  const [name,setName]=useState('');const [type,setType]=useState<'VARIANT'|'SUPPLEMENT'>('VARIANT');const [required,setRequired]=useState(false);const [min,setMin]=useState(0);const [max,setMax]=useState(1);
  const [rows,setRows]=useState<Array<{name:string;priceDelta:string;currency:'CDF'|'USD';linkedProductId:string}>>([{name:'',priceDelta:'0',currency:'CDF',linkedProductId:''}]);
  async function save(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const options=rows.filter(row=>row.name.trim()).map((row,position)=>({...row,position,...(row.linkedProductId?{linkedProductId:row.linkedProductId}:{})}));const result=await action.run(()=>api(`/menus/products/${product.id}/option-groups`,{name,type,required,minSelections:min,maxSelections:max,options}),'Options enregistrées.');if(result){setName('');setRows([{name:'',priceDelta:'0',currency:'CDF',linkedProductId:''}]);}}
  return <section className="card section"><h3>Personnalisation · {product.name}</h3><p className="muted small">Les variantes sont incluses. Les suppléments peuvent utiliser le prix et le stock d’un produit lié.</p><Feedback error={action.error} notice={action.notice}/><div className="list">{groups.data?.filter(group=>group.active).map(group=><div className="item" key={group.id}><span className="badge">{group.type==='VARIANT'?'Variante':'Supplément'} · {group.name} · {group.minSelections}–{group.maxSelections}</span><button className="secondary" type="button" onClick={()=>action.run(()=>apiDelete(`/menus/option-groups/${group.id}`),'Groupe archivé.')}>Archiver</button></div>)}</div><form onSubmit={save} className="section"><div className="form-grid"><label>Nom du groupe<input value={name} onChange={e=>setName(e.target.value)} placeholder="Accompagnement" required/></label><label>Type<select value={type} onChange={e=>setType(e.target.value as 'VARIANT'|'SUPPLEMENT')}><option value="VARIANT">Variante incluse</option><option value="SUPPLEMENT">Supplément</option></select></label><label>Minimum de choix<input type="number" min="0" max="20" value={min} onChange={e=>setMin(Number(e.target.value))}/></label><label>Maximum de choix<input type="number" min="1" max="20" value={max} onChange={e=>setMax(Number(e.target.value))}/></label></div><label><span><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/> Choix obligatoire</span></label>{rows.map((row,index)=><div className="form-grid" key={index}><label>Option<input value={row.name} onChange={e=>setRows(current=>current.map((v,i)=>i===index?{...v,name:e.target.value}:v))} placeholder="Foufou"/></label><label>Prix supplémentaire<input type="number" min="0" step="0.01" value={row.priceDelta} onChange={e=>setRows(current=>current.map((v,i)=>i===index?{...v,priceDelta:e.target.value}:v))} disabled={type==='VARIANT'||!!row.linkedProductId}/></label><label>Devise<select value={row.currency} onChange={e=>setRows(current=>current.map((v,i)=>i===index?{...v,currency:e.target.value as 'CDF'|'USD'}:v))}><option>CDF</option><option>USD</option></select></label><label>Produit lié (prix et stock)<select value={row.linkedProductId} onChange={e=>setRows(current=>current.map((v,i)=>i===index?{...v,linkedProductId:e.target.value}:v))}><option value="">Prix fixe du supplément</option>{products.filter(p=>p.id!==product.id&&p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>)}<div className="actions"><button className="secondary" type="button" onClick={()=>setRows(current=>[...current,{name:'',priceDelta:'0',currency:'CDF',linkedProductId:''}])}>Ajouter une option</button><button className="primary" disabled={action.busy||!name.trim()||rows.every(row=>!row.name.trim())}>Enregistrer le groupe</button></div></form></section>;
}

function productImageUrl(value: string | null | undefined) {
  return value && /^\/api\/v1\/product-images\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(value) ? value : null;
}

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

  const [versionImage, setVersionImage] = useState<File | null>(null);

  async function saveImage() {
    if (!versionImage) return;
    const result = await action.run(async () => {
      const form = new FormData();
      form.append('image', versionImage);
      const uploaded = await apiForm<{ url: string }>('/menus/menu-images', form);
      return api(`/menus/versions/${version.id}/image`, { imageUrl: uploaded.url });
    }, 'Image du menu enregistrée.');
    if (result) setVersionImage(null);
  }

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

      {version.imageUrl && (
        <img src={version.imageUrl} alt={`Image du menu, version ${version.version}`} style={{ display: 'block', width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 12, margin: '14px 0' }} />
      )}

      {version.status === 'DRAFT' && (
        <div className="actions">
          <label>
            Image du menu
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setVersionImage(event.target.files?.[0] ?? null)} />
          </label>
          <button type="button" className="secondary" disabled={action.busy || !versionImage} onClick={saveImage}>Enregistrer l’image</button>
        </div>
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
                    item.quantitySold +
                    item.quantityReserved,
                  );

                return (
                  <tr
                    key={item.id}
                  >
                    <td>
                      <img src={productImageUrl(item.product.imageUrl) ?? '/products/placeholder.svg'} alt="" width={52} height={44} style={{ display: 'block', objectFit: 'cover', borderRadius: 7, marginBottom: 6 }} />
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

      {productId && products.length > 0 && (
        <ProductOptionsEditor
          product={products.find(product => product.id === productId)!}
          products={products}
        />
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
        async () => {
          let imageUrl: string | undefined;
          if (menuImage) {
            const form = new FormData();
            form.append('image', menuImage);
            imageUrl = (await apiForm<{ url: string }>('/menus/menu-images', form)).url;
          }
          return api('/menus', {
            businessDate:
              selectedDate,

            serviceCode,

            notes,
            ...(imageUrl ? { imageUrl } : {}),
          });
        },

        'Brouillon créé.',
      );

    if (result) {
      setNotes('');
      setMenuImage(null);
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
