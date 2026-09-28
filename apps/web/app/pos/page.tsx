'use client';
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ProductImage } from '../../components/product-image';
import { useData, useAction, Feedback, Heading, Loading } from '../../components/common';
import { useUser } from '../../components/shell';
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
type Order={id:string;number:string;totalAmount:string;currency:string;createdAt?:string;serviceMode?:string;commercialTotal?:string;coveredAmount?:string;delivery?:{addressSnapshot:Record<string,unknown>;status:string}|null;items?:{id:string;quantity:string;lineTotal:string;productSnapshot:{name?:string};variantsSnapshot?:Record<string,string>|null;supplementsSnapshot?:{name:string;unitPrice:string;quantity:number}[]|null}[];payments?:{id:string;status:string;method:string;amountDue:string}[];client?:{firstName:string;lastName:string;ulcNumber:string|null;phone:string|null;category:{code:string;label:string}}|null;paidAmount?:string;remainingAmount?:string;pendingPayment?:{id:string;status:string;method:string;amountDue:string}|null};
type CollectOrder=Order & {createdAt:string;items:NonNullable<Order['items']>;client:NonNullable<Order['client']>};
type CollectQueue={orders:CollectOrder[];total:number};
type TerminalConfig={mode:'MOCK'|'MANUAL'|'INTEGRATED';provider:string;terminalId:string|null;simulated:boolean};
type PaymentResult={id:string;status:string;amountDue?:string;changeAmount:string;changeCurrency:string|null;remainingAmount:string;orderStatus:string;method?:string;terminal?:{status:string;externalReference?:string;provider?:string;terminalId?:string;message?:string}};
export default function Pos(){const [view,setView]=useState<'NEW'|'COLLECT'>('NEW'),[queueSearch,setQueueSearch]=useState(''),[orderSource,setOrderSource]=useState<'POS'|'CLIENT'>('POS'),[category,setCategory]=useState('ETUDIANT_EXTERNE'),[mode,setMode]=useState(''),[cart,setCart]=useState<{p:Product;quantity:number}[]>([]),[order,setOrder]=useState<Order|null>(null),[method,setMethod]=useState('CASH'),[currency,setCurrency]=useState('CDF'),[received,setReceived]=useState(''),[reference,setReference]=useState('');const terminalConfig=useData<TerminalConfig>('/orders/terminal/config');const terminalStartKey=useRef('');const paymentAttempt=useRef<{signature:string;key:string}|null>(null);
const [
  payment,
  setPayment,
] = useState<PaymentResult | null>(null);;const [clientQuery, setClientQuery] =
  useState('');

const [
  selectedClient,
  setSelectedClient,
] = useState<Client | null>(null);
const [service,setService]=useState('LUNCH');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kinshasa'}).format(new Date());
const menu=useData<{version:{id:string;items:{productId:string;name:string;imageUrl:string;price:{amount:string;currency:string};quantityAvailable:number;quantitySold:number;quantityReserved:number;remaining:number}[]}}|null>(`/menus/active?date=${today}&serviceCode=${service}&categoryCode=${category}`);
const products={isLoading:menu.isLoading,error:menu.error,data:menu.data?.version.items.filter(item=>item.price.currency==='CDF').map(item=>({id:item.productId,name:item.name,imageUrl:item.imageUrl,quantityAvailable:item.quantityAvailable,quantitySold:item.quantitySold,quantityReserved:item.quantityReserved,remaining:item.remaining,prices:[{versions:[item.price]}]}))};
const clients =
  useData<Client[]>(
    '/clients?q=' +
      encodeURIComponent(
        clientQuery,
      ) +
      '&limit=10',
  );
const session = useData<{id:string}|null>('/cash');const collectOrders=useData<CollectQueue>(`/orders/client-to-collect?q=${encodeURIComponent(queueSearch)}`);const queueRows=collectOrders.data?.orders??[];const queueCount=collectOrders.data?.total??0;const action=useAction();const user=useUser();const total=useMemo(()=>cart.reduce((n,{p,quantity})=>n+Number(p.prices[0]?.versions[0]?.amount??0)*quantity,0),[cart]);const orderRemaining=payment?.remainingAmount??order?.remainingAmount??order?.totalAmount??'0';async function submitOrderPayment(){if(!order||!session.data)return;const body={cashSessionId:session.data.id,method,receivedAmount:received||orderRemaining,receivedCurrency:method==='CASH'?currency:order.currency,...(method==='CASH'?{}:{externalReference:reference.trim()})};const signature=JSON.stringify({orderId:order.id,body});if(!paymentAttempt.current||paymentAttempt.current.signature!==signature)paymentAttempt.current={signature,key:crypto.randomUUID()};const result=await api<PaymentResult>('/orders/'+order.id+'/payments',body,paymentAttempt.current.key);paymentAttempt.current=null;setPayment(result);if(orderSource==='CLIENT'&&result.orderStatus!=='CONFIRMED')setOrder(current=>current?{...current,paidAmount:(Number(current.paidAmount??0)+Number(result.amountDue??0)).toString(),remainingAmount:result.remainingAmount}:null);setReference('');if(result.orderStatus!=='CONFIRMED')setReceived(result.remainingAmount);}return <><Heading title="Caisse · terminal de vente" subtitle="Encaissez les ventes et les commandes du portail client."/><div className="tabs" role="tablist" aria-label="Vues du terminal"><button type="button" className={view==='NEW'?'primary':'secondary'} aria-selected={view==='NEW'} onClick={()=>{setView('NEW');setOrder(null);setPayment(null);setOrderSource('POS');}}>Nouvelle vente</button><button type="button" className={view==='COLLECT'?'primary':'secondary'} aria-selected={view==='COLLECT'} onClick={()=>{setView('COLLECT');setOrder(null);setPayment(null);setOrderSource('CLIENT');}}>{`Commandes à encaisser (${queueCount})`}</button></div><Feedback {...action}/>{!session.data&&<p className="error">Ouvrez une session dans <Link href="/cash"><u>Caisses & clôtures</u></Link> avant d’encaisser.</p>}<div className="pos">{view==='NEW'?<section className="card"><h2>Le menu du campus</h2>
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
      <option value="">Choisir un mode de service</option><option value="DINE_IN">
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
        <small className="muted">Restant : {p.remaining} · Prévu : {p.quantityAvailable} · Vendu : {p.quantitySold}{p.quantityReserved>0?` · Réservé : ${p.quantityReserved}`:''}</small>
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
</section>:<section className="card"><div className="toolbar"><div><h2>Commandes front-office</h2><span className="muted small">Les plus anciennes d’abord · commandes déjà créées</span></div><strong className="badge">{queueCount}</strong></div><label>Rechercher numéro, client, matricule ou téléphone<input value={queueSearch} onChange={event=>setQueueSearch(event.target.value)} placeholder="WEB-… / nom / matricule / téléphone" /></label><Loading loading={collectOrders.isLoading} error={collectOrders.error}/><div className="list">{queueRows.map(row=><button key={row.id} type="button" className="item pos-queue-item" aria-pressed={order?.id===row.id} onClick={()=>{setOrder(row);setOrderSource('CLIENT');setCategory(row.client.category.code);setMode(row.serviceMode??'DINE_IN');setPayment(row.pendingPayment?{id:row.pendingPayment.id,status:'PENDING',amountDue:row.pendingPayment.amountDue,remainingAmount:row.remainingAmount??row.totalAmount,orderStatus:'RECEIVED',method:row.pendingPayment.method,changeAmount:'0',changeCurrency:null}:null);setReceived(row.remainingAmount??row.totalAmount);setMethod('CASH');setReference('');terminalStartKey.current='';paymentAttempt.current=null;}}><span><strong>{row.number}</strong><br/><span>{row.client.firstName} {row.client.lastName}</span><br/><small className="muted">{row.client.category.label} · {row.serviceMode==='TAKEAWAY'?'À emporter':row.serviceMode==='DELIVERY'?'Livraison':'Sur place'} · {new Intl.DateTimeFormat('fr-CD',{dateStyle:'short',timeStyle:'short'}).format(new Date(row.createdAt))}</small><br/><small>{row.items.map(item=>`${item.productSnapshot.name??'Article'} ×${item.quantity}`).join(' · ')}</small><br/><small className={row.pendingPayment?'status-warning':'muted'}>{row.pendingPayment?`Paiement en attente · ${row.pendingPayment.method}`:`Reste ${money(row.remainingAmount??row.totalAmount,row.currency)}`}</small></span><strong>{money(row.totalAmount,row.currency)}<br/><small className="badge">Ouvrir · encaisser</small></strong></button>)}{!collectOrders.isLoading&&!collectOrders.error&&!queueRows.length&&<p className="empty">Aucune commande web à encaisser.</p>}</div></section>}

<section className="card">
  <h2>
    Votre commande{' '}
    {order && (
      <span className="badge">
        {order.number}
      </span>
    )}
  </h2>

  {orderSource==='CLIENT'&&order ? (
    <div className="pos-order-detail"><div className="item"><span><strong>{order.client?.firstName} {order.client?.lastName}</strong><br/><small className="muted">{order.client?.category.label} · {order.client?.ulcNumber??order.client?.phone??'Client'}</small><br/><small className="muted">{order.serviceMode==='TAKEAWAY'?'À emporter':order.serviceMode==='DELIVERY'?'Livraison':'Sur place'} · {order.createdAt?new Intl.DateTimeFormat('fr-CD',{dateStyle:'medium',timeStyle:'short'}).format(new Date(order.createdAt)):''}</small></span><button type="button" className="secondary" onClick={()=>{setOrder(null);setPayment(null);}}>Fermer</button></div>{Number(order.coveredAmount??0)>0&&<p className="success"><strong>COUVERT PAR ABONNEMENT</strong><br/>Montant commercial : {money(order.commercialTotal??order.totalAmount,order.currency)} · Pris en charge : {money(order.coveredAmount??'0',order.currency)} · Reste à payer : {money(order.totalAmount,order.currency)}</p>}<h3>Articles</h3>{order.items?.map(item=><div className="pos-order-line" key={item.id}><strong>{item.productSnapshot.name??'Article'} × {item.quantity}</strong>{item.variantsSnapshot&&Object.entries(item.variantsSnapshot).map(([name,value])=><small className="muted" key={name}>• {name} : {value}</small>)}{item.supplementsSnapshot?.map((extra,index)=><small className="muted" key={`${extra.name}-${index}`}>• + {extra.name} ×{extra.quantity}</small>)}</div>)}<div className="section"><small className="muted">Total commercial</small><strong>{money(order.commercialTotal??order.totalAmount,order.currency)}</strong></div>{Number(order.coveredAmount??0)>0&&<p className="muted small">Pris en charge : {money(order.coveredAmount??'0',order.currency)}</p>}<div className="section"><small className="muted">Reste à payer</small><div className="metric">{money(orderRemaining,order.currency)}</div></div>{Number(order.paidAmount??0)>0&&<p className="muted">Déjà payé : {money(order.paidAmount??'0',order.currency)}</p>}</div>
  ) : cart.length === 0 ? (
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
          !cart.length || !mode ||
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
              setOrderSource('POS');
              setPayment(null);
              setMethod('CASH');
              setReference('');
              terminalStartKey.current = '';

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
  ) : payment?.orderStatus === 'CONFIRMED' ? (
    <>
      <p className="success">✓ Paiement confirmé. ✓ Commande envoyée automatiquement à la cuisine.</p>
      <p>Monnaie à rendre : <strong>{money(payment.changeAmount, payment.changeCurrency ?? order.currency)}</strong></p>
      <Link className="primary" href={'/orders?receipt=' + order.id}>Voir le reçu</Link>
      <button type="button" className="secondary" onClick={() => { setOrder(null); setCart([]); setPayment(null); setSelectedClient(null); setClientQuery(''); setReference(''); setMethod('CASH'); terminalStartKey.current=''; if(orderSource==='CLIENT')setView('COLLECT');else setView('NEW'); }}>Nouvelle opération</button>
    </>
  ) : (
    <>
      {payment && Number(payment.remainingAmount) > 0 && <p className="success">Reste à payer : <strong>{money(payment.remainingAmount, order.currency)}</strong></p>}
      {payment?.status === 'FAILED' && <p className="error">Paiement refusé. Aucun montant n’a été confirmé; choisissez un moyen et réessayez.</p>}
      {payment?.status === 'CANCELLED' && <p className="preview">Paiement annulé. Aucun montant n’a été confirmé.</p>}
      {payment?.status === 'PENDING' ? (
        <section className="pos-terminal-state" aria-live="polite">
          <h2>{payment.method==='CARD'?(payment.terminal?.status === 'PROCESSING' ? 'Paiement en cours' : 'Paiement à vérifier'):'Paiement externe en attente de confirmation'}</h2>
          <strong className="pos-terminal-amount">{money(payment.amountDue ?? orderRemaining, order.currency)}</strong>
          <p>{payment.method==='CARD'?`Commande ${order.number} · TPE ${payment.terminal?.terminalId ?? terminalConfig.data?.terminalId ?? 'manuel'}`:`Commande ${order.number} · ${payment.method}`}</p>
          <p>{payment.terminal?.message ?? (payment.method==='CARD'?'Ne redemandez pas un paiement avant d’avoir vérifié le statut sur le terminal.':'Vérifiez le paiement puis demandez une confirmation à une personne autorisée.')}</p>
          {payment.terminal?.externalReference && <p>Référence : <code>{payment.terminal.externalReference}</code></p>}
          {payment.method==='CARD'&&terminalConfig.data?.mode === 'MOCK' && <div className="pos-terminal-simulations"><p>Simulation de développement — aucun paiement bancaire réel :</p>{(['APPROVED','DECLINED','CANCELLED','TIMEOUT','UNKNOWN'] as const).map(status=><button key={status} type="button" className="secondary" disabled={action.busy} onClick={()=>action.run(async()=>{const result=await api<{payment:PaymentResult;terminal:NonNullable<PaymentResult['terminal']>}>('/orders/payments/'+payment.id+'/terminal-simulate',{status});if(result.payment.status==='CONFIRMED'){setPayment({...payment,...result.payment,remainingAmount:payment.remainingAmount,orderStatus:Number(payment.remainingAmount)===0?'CONFIRMED':'RECEIVED',terminal:result.terminal});}else{const failed=['FAILED','CANCELLED'].includes(result.payment.status);setPayment({...payment,...result.payment,remainingAmount:failed?String(Number(payment.amountDue??order.totalAmount)+Number(payment.remainingAmount)):payment.remainingAmount,orderStatus:'RECEIVED',terminal:result.terminal});if(failed)terminalStartKey.current='';}},'Résultat de simulation enregistré.')}>{status==='APPROVED'?'Simuler accepté':status==='DECLINED'?'Simuler refusé':status==='CANCELLED'?'Simuler annulé':status==='TIMEOUT'?'Simuler délai dépassé':'Simuler statut inconnu'}</button>)}</div>}
          {(payment.method!=='CARD'||terminalConfig.data?.mode === 'MANUAL')&&user?.permissions.includes('payments.confirm')&&<button type="button" className="primary full" disabled={action.busy} onClick={()=>action.run(async()=>{const result=await api<PaymentResult>('/orders/payments/'+payment.id+'/confirm',{});setPayment({...payment,...result,status:'CONFIRMED',remainingAmount:payment.remainingAmount,orderStatus:Number(payment.remainingAmount)===0?'CONFIRMED':'RECEIVED'});},'Paiement confirmé.')}>Confirmer après vérification</button>}
          {payment.method==='CARD'&&<button type="button" className="secondary" disabled={action.busy} onClick={()=>action.run(async()=>{const result=await api<{payment:PaymentResult;terminal:NonNullable<PaymentResult['terminal']>}>('/orders/payments/'+payment.id+'/terminal-status',{});if(result.payment.status==='CONFIRMED')setPayment({...payment,...result.payment,orderStatus:Number(payment.remainingAmount)===0?'CONFIRMED':'RECEIVED'});else if(result.payment.status==='FAILED'||result.payment.status==='CANCELLED'){setPayment({...payment,...result.payment,remainingAmount:String(Number(payment.amountDue??order.totalAmount)+Number(payment.remainingAmount)),orderStatus:'RECEIVED'});terminalStartKey.current='';}else setPayment({...payment,...result.payment,terminal:result.terminal});},'Statut relu sur le terminal.')}>Vérifier le statut</button>}
          <p className="muted small">Ne demandez pas immédiatement au client de payer une deuxième fois si le statut est incertain.</p>
        </section>
      ) : (
        <>
          <h3>Comment le client souhaite-t-il payer ?</h3>
          <div className="pos-payment-methods">{[
            ['CASH','Espèces'],['CARD','Carte / TPE'],['MPESA','M-Pesa'],['ORANGE_MONEY','Orange Money'],['AIRTEL_MONEY','Airtel Money'],['TRANSFER','Virement'],
          ].map(([value,label])=><button type="button" key={value} className={method===value?'pos-payment-choice selected':'pos-payment-choice'} onClick={()=>setMethod(value)}>{label}</button>)}</div>
          {method === 'CARD' ? (
            <div className="pos-terminal-panel">
              <h3>Paiement par carte</h3>
              <strong className="pos-terminal-amount">{money(payment?.remainingAmount ?? orderRemaining, order.currency)}</strong>
              <p>Commande {order.number}</p><p>TPE : {terminalConfig.data?.terminalId ?? (terminalConfig.data?.mode==='MOCK'?'TPE-DEV-01':'à configurer')} · Mode {terminalConfig.data?.mode ?? 'chargement…'}</p>
              {terminalConfig.data?.mode === 'INTEGRATED' && <p className="error">Aucun adaptateur bancaire officiel n’est configuré. Aucun paiement ne sera envoyé.</p>}
              {terminalConfig.data?.mode === 'MANUAL' && <><p>Effectuez d’abord la transaction sur le terminal indépendant. Saisissez uniquement la référence fournie par le TPE; jamais de numéro de carte, PIN ou CVV.</p><label>Référence de transaction<input value={reference} maxLength={120} autoComplete="off" onChange={e=>setReference(e.target.value)} placeholder="Référence indiquée sur le TPE"/></label></>}
              {terminalConfig.data?.mode !== 'INTEGRATED' && <button type="button" className="primary full" disabled={action.busy||!session.data||!terminalConfig.data||(terminalConfig.data.mode==='MANUAL'&&!reference.trim())} onClick={()=>action.run(async()=>{if(!terminalStartKey.current)terminalStartKey.current=crypto.randomUUID();const body={cashSessionId:session.data!.id,...(terminalConfig.data?.mode==='MANUAL'?{externalReference:reference.trim()}:{})};const result=await api<PaymentResult>('/orders/'+order.id+'/terminal-payments',body,terminalStartKey.current);setPayment({...result,remainingAmount:result.remainingAmount??'0',orderStatus:'RECEIVED'});setReference('');},terminalConfig.data?.mode==='MOCK'?'Simulation TPE prête. Choisissez son résultat.':'Référence transmise. Confirmez après vérification.')}>{terminalConfig.data?.mode==='MOCK'?'Lancer la simulation TPE':terminalConfig.data?.mode==='MANUAL'?'Enregistrer la référence TPE':'Chargement du mode TPE…'}</button>}
            </div>
          ) : (
            <>
              {method !== 'CASH' && <label>Référence externe<input value={reference} maxLength={120} autoComplete="off" onChange={e=>setReference(e.target.value)} placeholder="Référence non sensible du paiement"/></label>}
              {method === 'CASH' && <div className="form-grid"><label>Devise reçue<select value={currency} onChange={e=>setCurrency(e.target.value)}><option value="CDF">CDF</option><option value="USD">USD</option></select></label></div>}
              <label>{method==='CASH'?'Montant reçu':`Montant reçu (${order.currency})`}<input value={received} inputMode="decimal" onChange={e=>setReceived(e.target.value)}/></label>
              {method === 'CASH' && <p className="muted small">Le serveur vérifie le montant, le taux autorisé et le fonds de caisse avant de confirmer.</p>}
              <button type="button" className="primary full" disabled={action.busy||!session.data||(method!=='CASH'&&!reference.trim())} onClick={()=>action.run(submitOrderPayment,method==='CASH'?'Paiement espèces enregistré.':'Paiement créé en attente de confirmation autorisée.')}>{method==='CASH'?'Enregistrer le paiement':'Enregistrer le paiement externe'}</button>
            </>
          )}
        </>
      )}
    </>
  )}</section>
</div>
</>;
}
