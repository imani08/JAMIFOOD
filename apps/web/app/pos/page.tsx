'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ProductImage } from '../../components/product-image';
import { useData, useAction, Feedback, Heading, Loading } from '../../components/common';
import { api, money } from '../../lib/api';
type Product={
  id:string;
  name:string;
  imageUrl:string;
  prices:{
    versions:{
      amount:string;
      currency:string
    }[]
  }[]
};
type Client = {
  id: string;
  firstName: string;
  lastName: string;
  ulcNumber: string | null;
  phone: string | null;

  category: {
    code: string;
    label: string;
  };
};
type Order={id:string;number:string;totalAmount:string;currency:string};
export default function Pos(){const [category,setCategory]=useState('ETUDIANT_EXTERNE'),[mode,setMode]=useState('DINE_IN'),[cart,setCart]=useState<{p:Product;quantity:number}[]>([]),[order,setOrder]=useState<Order|null>(null),[method,setMethod]=useState('CASH'),[currency,setCurrency]=useState('CDF'),[received,setReceived]=useState(''),[reference,setReference]=useState('')
const [
  payment,
  setPayment,
] = useState<{
  status: string;
  changeAmount: string;
  changeCurrency:
    | string
    | null;
  remainingAmount: string;
  orderStatus: string;
} | null>(null);;const [clientQuery, setClientQuery] =
  useState('');

const [
  selectedClient,
  setSelectedClient,
] = useState<Client | null>(null);
const [service,setService]=useState('LUNCH');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kinshasa'}).format(new Date());
const menu=useData<{version:{id:string;items:{productId:string;name:string;imageUrl:string;price:{amount:string;currency:string}}[]}}|null>(`/menus/active?date=${today}&serviceCode=${service}&categoryCode=${category}`);
const products={isLoading:menu.isLoading,error:menu.error,data:menu.data?.version.items.filter(item=>item.price.currency==='CDF').map(item=>({id:item.productId,name:item.name,imageUrl:item.imageUrl,prices:[{versions:[item.price]}]}))};
const clients =
  useData<Client[]>(
    '/clients?q=' +
      encodeURIComponent(
        clientQuery,
      ) +
      '&limit=10',
  );
const session = useData<{id:string}|null>('/cash');const action=useAction();const total=useMemo(()=>cart.reduce((n,{p,quantity})=>n+Number(p.prices[0]?.versions[0]?.amount??0)*quantity,0),[cart]);return <><Heading title="Caisse · terminal de vente" subtitle="Encaissez, remettez le ticket, puis suivez la préparation."/><Feedback {...action}/>{!session.data&&<p className="error">Ouvrez une session dans <Link href="/cash"><u>Caisses & clôtures</u></Link> avant d’encaisser.</p>}<div className="pos"><section className="card"><h2>Le menu du campus</h2>
<div className="section">
  <label>Service du menu publié<select value={service} disabled={!!order} onChange={event=>{setService(event.target.value);setCart([]);}}><option value="BREAKFAST">Petit déjeuner</option><option value="LUNCH">Déjeuner</option><option value="DINNER">Dîner</option></select></label>
  {!menu.isLoading && !menu.data && <p role="status">Aucun menu publié pour ce service. Publiez le menu avant de vendre au POS.</p>}
  <h3>Client</h3>

  {selectedClient ? (
    <div className="item">
      <span>
        <strong>
          {selectedClient.firstName}{' '}
          {selectedClient.lastName}
        </strong>

        <br />

        <small className="muted">
          {selectedClient.category.label}
          {' · '}
          {selectedClient.ulcNumber ||
            selectedClient.phone ||
            'Sans matricule'}
        </small>
      </span>

      {!order && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setSelectedClient(null);
            setClientQuery('');
          }}
        >
          Vente anonyme
        </button>
      )}
    </div>
  ) : (
    <>
      <label>
        Rechercher un client

        <input
          value={clientQuery}
          disabled={!!order}
          placeholder="Nom, matricule ou téléphone"
          onChange={(e) =>
            setClientQuery(e.target.value)
          }
        />
      </label>

      {clientQuery.trim() !== '' && (
        <div className="list">
          {clients.data?.map((client) => (
            <button
              key={client.id}
              type="button"
              className="item"
              disabled={!!order}
              onClick={() => {
                setSelectedClient(client);

                setCategory(
                  client.category.code,
                );

                setCart([]);
                setClientQuery('');
              }}
            >
              <span>
                <strong>
                  {client.firstName}{' '}
                  {client.lastName}
                </strong>

                <br />

                <small className="muted">
                  {client.category.label}
                  {' · '}
                  {client.ulcNumber ||
                    client.phone ||
                    'Sans matricule'}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="muted small">
        Laissez vide pour une vente
        anonyme.
      </p>
    </>
  )}
  
</div><div className="form-grid">
  <label>
    Catégorie client

    <select
      value={category}
      disabled={
        !!order ||
        !!selectedClient
      }
      onChange={(e) => {
        setCategory(
          e.target.value,
        );

        setCart([]);
      }}
    >
      <option value="ETUDIANT_EXTERNE">
        Étudiant externe
      </option>

      <option value="ETUDIANT_HOME">
        Étudiant résident Home
      </option>

      <option value="PERSONNEL_ULC">
        Personnel ULC
      </option>
    </select>
  </label>

  <label>
    Mode de service

    <select
      value={mode}
      disabled={!!order}
      onChange={(e) =>
        setMode(
          e.target.value,
        )
      }
    >
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
</div>

<Loading
  loading={products.isLoading}
  error={products.error}
/>

<div className="products">
  {products.data
    ?.filter(
      (p) =>
        p.prices[0]?.versions[0],
    )
    .map((p) => (
      <button
        type="button"
        className="product"
        key={p.id}
        disabled={!!order}
        onClick={() =>
          setCart((current) => {
            const item =
              current.find(
                (x) =>
                  x.p.id === p.id,
              );

            return item
              ? current.map((x) =>
                  x.p.id === p.id
                    ? {
                        ...x,
                        quantity:
                          x.quantity +
                          1,
                      }
                    : x,
                )
              : [
                  ...current,
                  {
                    p,
                    quantity: 1,
                  },
                ];
          })
        }
      >
        <span>{p.name}</span>
        <ProductImage value={p.imageUrl} name={p.name} />

        <strong>
          {money(
            p.prices[0]
              .versions[0]
              .amount,
          )}
        </strong>

        <small>
          + Ajouter au panier
        </small>
      </button>
    ))}
</div>
</section>

<section className="card">
  <h2>
    Votre commande{' '}
    {order && (
      <span className="badge">
        {order.number}
      </span>
    )}
  </h2>

  {cart.length === 0 ? (
    <p className="empty">
      Ajoutez un repas pour
      commencer.
    </p>
  ) : (
    <>
      {cart.map(
        ({ p, quantity }) => (
          <div
            className="item"
            key={p.id}
          >
            <div>
              <strong>
                {p.name}
              </strong>

              <br />

              <small className="muted">
  Prix :{' '}
  {money(
    p.prices[0].versions[0].amount,
  )}
  {' × '}
  {quantity}
  {' = '}
  <strong>
    {money(
      Number(
        p.prices[0].versions[0].amount,
      ) * quantity,
    )}
  </strong>
</small>
            </div>

            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={!!order}
                onClick={() =>
                  setCart(
                    (current) =>
                      current
                        .map(
                          (item) =>
                            item.p
                              .id ===
                            p.id
                              ? {
                                  ...item,
                                  quantity:
                                    item.quantity -
                                    1,
                                }
                              : item,
                        )
                        .filter(
                          (item) =>
                            item.quantity >
                            0,
                        ),
                  )
                }
              >
                −
              </button>

              <strong>
                {quantity}
              </strong>

              <button
                type="button"
                className="secondary"
                disabled={!!order}
                onClick={() =>
                  setCart(
                    (current) =>
                      current.map(
                        (item) =>
                          item.p.id ===
                          p.id
                            ? {
                                ...item,
                                quantity:
                                  item.quantity +
                                  1,
                              }
                            : item,
                      ),
                  )
                }
              >
                +
              </button>

              <button
                type="button"
                className="secondary"
                disabled={!!order}
                onClick={() =>
                  setCart(
                    (current) =>
                      current.filter(
                        (item) =>
                          item.p.id !==
                          p.id,
                      ),
                  )
                }
              >
                Retirer
              </button>
            </div>
          </div>
        ),
      )}

      <div className="section">
        <span className="muted">
          Total
        </span>

        <div className="metric">
          {money(
            order?.totalAmount ??
              total,
          )}
        </div>
      </div>
    </>
  )}

  {!order ? (
    <>
      {mode === 'DELIVERY' &&
        !selectedClient && (
          <p className="error">
            Une livraison exige
            l’identification du
            client.
          </p>
        )}

      <button
        type="button"
        className="primary full"
        disabled={
          !cart.length ||
          !session.data ||
          action.busy ||
          (mode ===
            'DELIVERY' &&
            !selectedClient)
        }
        onClick={() =>
          action.run(
            async () => {
              const o =
                await api<Order>(
                  '/orders',
                  {
                    ...(selectedClient
                      ? {
                          clientId:
                            selectedClient.id,
                        }
                      : {}),

                    categoryCode:
                      category,
                    menuVersionId: menu.data?.version.id,

                    serviceMode:
                      mode,

                    currency:
                      'CDF',

                    items:
                      cart.map(
                        (x) => ({
                          productId:
                            x.p.id,

                          quantity:
                            x.quantity,
                        }),
                      ),
                  },
                );

              setOrder(o);

              setReceived(
                o.totalAmount,
              );
            },
            'Commande enregistrée. Procédez au paiement.',
          )
        }
      >
        Passer au paiement
      </button>
    </>
  )  : payment?.orderStatus ===
  'CONFIRMED' ? (
    <>
      <p
        className={
          payment.status ===
          'CONFIRMED'
            ? 'success'
            : 'preview'
        }
      >
        {payment.status ===
        'CONFIRMED'
          ? 'Paiement confirmé'
          : 'Paiement en attente de vérification par un responsable.'}
      </p>

      {payment.status ===
        'CONFIRMED' && (
        <>
          <p>
            Monnaie à rendre :{' '}
            <strong>
              {money(
  payment.changeAmount,
  payment.changeCurrency ??
    order.currency,
)}
            </strong>
          </p>

          <Link
            className="primary"
            href={
              '/orders?receipt=' +
              order.id
            }
          >
            Voir le reçu
          </Link>
        </>
      )}

      <button
        type="button"
        className="secondary"
        onClick={() => {
          setOrder(null);
          setCart([]);
          setPayment(null);
          setSelectedClient(null);
          setClientQuery('');
        }}
      >
        Nouvelle commande
      </button>
    </>
  ) : (
    <>
      
      {payment &&
  Number(payment.remainingAmount) > 0 && (
    <p className="success">
      Paiement enregistré.
      {' '}Reste à payer :{' '}
      <strong>
        {money(
          payment.remainingAmount,
          order.currency,
        )}
      </strong>
    </p>
  )}<div className="form-grid">
        <label>
  Moyen de paiement

  <div className="item">
    <strong>
      Espèces
    </strong>

    <span className="badge">
      CASH
    </span>
  </div>
</label>

        <label>
          Devise reçue

          <select
            value={currency}
            onChange={(e) =>
              setCurrency(
                e.target.value,
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
      {payment &&
  Number(
    payment.remainingAmount,
  ) > 0 && (
    <p className="success">
      Règlement enregistré.
      Reste à payer :{' '}
      <strong>
        {money(
          payment.remainingAmount,
          order.currency,
        )}
      </strong>
    </p>
  )}

      <label>
        Montant reçu

        <input
          value={received}
          inputMode="decimal"
          onChange={(e) =>
            setReceived(
              e.target.value,
            )
          }
        />
      </label>

     

      <p className="muted small">
  Paiement en espèces uniquement
  pour la première mise en service.
  Les règlements peuvent être
  reçus en CDF ou en USD.
</p>

      <button
        type="button"
        className="primary full"
        disabled={
          action.busy ||
          !session.data
        }
        onClick={() =>
  action.run(
    async () => {
      const result =
        await api<{
          status: string;
          changeAmount: string;
          changeCurrency:
            | string
            | null;
          remainingAmount: string;
          orderStatus: string;
        }>(
          '/orders/' +
            order.id +
            '/payments',
          {
            cashSessionId:
              session.data!.id,

            method: 'CASH',

            receivedAmount:
              received,

            receivedCurrency:
              currency,
          },
        );

      setPayment(result);

      if (
        result.orderStatus !==
        'CONFIRMED'
      ) {
        setReceived('');
      }
    },
    'Paiement enregistré.',
  )
}
      >
        Enregistrer le paiement
      </button>
    </>
  )}
</section>
</div>
</>;
}
