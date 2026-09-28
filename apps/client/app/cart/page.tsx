'use client';

import Link from 'next/link';
import { Fragment, FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowRight } from '../icons';
import { ApiError, clientApi } from '../lib/api';
import { EmptyCard, PageIntro } from '../ui';
import { getOrderAttempt, invalidateOrderAttempt, OrderAttemptPayload } from './idempotency';

type Selection = { groupId: string; optionIds: string[] };
type CartLine = {
  lineId: string; productId: string; name: string; quantity: number;
  price: { amount: string; currency: string }; variant?: string;
  optionSelections?: Selection[]; variantLabel?: string; supplementsLabel?: string; unitEstimate?: number;
  serviceCode?: 'BREAKFAST'|'LUNCH'|'DINNER'; menuVersionId?: string; businessDate?: string;
};
type Menu = {
  version: number; menuVersionId: string; serviceCode:'BREAKFAST'|'LUNCH'|'DINNER'; businessDate:string;
  items: Array<{ id: string; remaining: number; price: { amount: string; currency: string }; variants: string[] | null; optionGroups?: Array<{ id:string; type:'VARIANT'|'SUPPLEMENT'; options: Array<{ id:string; priceDelta:string; linkedProductId: string | null }> }> }>;
};
type Offers = { supplements: Array<{ id: string; name:string; amount:string; currency:string }> };
type OrderResult = { id:string;number:string;status:string;currency:string;commercialTotal:string;coveredAmount:string;totalAmount:string;mealRightId:string|null;deliveryFee?:number;deliveryIncluded?:boolean;lines:Array<{name:string;categoryCode:string;meal:boolean;quantity:number;coverageQuantity:number;commercialAmount:number;coveredAmount:number;amountDue:number;supplementAmount:number;supplement:boolean}> };
type DeliveryOptions={enabled:boolean;available:boolean;reason:string|null;serviceArea:'Campus ULC';zones:Array<{name:string;fee:number;currency:string}>;fee:number;currency:string;cutoffTime:string|null;schedule:Record<string,unknown>|null;serviceHours:Record<string,{start:string;end:string}>|null;recipientName:string;contactPhone:string};

export default function CartPage() {
  const submitting = useRef(false);
  const [items, setItems] = useState<CartLine[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [serviceMode, setServiceMode] = useState<'DINE_IN' | 'TAKEAWAY'|'DELIVERY'|''>('');
  const [deliveryOptions,setDeliveryOptions]=useState<DeliveryOptions|null>(null);
  const [delivery,setDelivery]=useState({recipientName:'',contactPhone:'',dropoffPoint:'',requestedDeliveryTime:'',instructions:''});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<OrderResult|null>(null);
  const [session, setSession] = useState(false);
  const [needsUnitConsent,setNeedsUnitConsent]=useState(false);
  const [acceptUnitPrice,setAcceptUnitPrice]=useState(false);

  function persist(next: CartLine[]) {
    setItems(next);
    localStorage.setItem('jami_cart', JSON.stringify(next));
    invalidateOrderAttempt(sessionStorage);
  }

  useEffect(() => {
    let initial: CartLine[] = [];
    try {
      const stored = JSON.parse(localStorage.getItem('jami_cart') ?? '[]') as Array<Partial<CartLine> & { productId: string; name: string; quantity: number; price: { amount: string; currency: string } }>;
      initial = stored.map((line, index) => ({ ...line, lineId: line.lineId ?? `${line.productId}:legacy:${index}`, optionSelections: line.optionSelections ?? [], unitEstimate: line.unitEstimate ?? Number(line.price.amount) })) as CartLine[];
    } catch { initial = []; }
    setItems(initial);

    const saved=initial[0]; if(saved?.menuVersionId&&saved.serviceCode&&saved.businessDate){clientApi<Menu|null>(`menus/public?date=${saved.businessDate}&serviceCode=${saved.serviceCode}`).then(current=>{if(current?.menuVersionId===saved.menuVersionId)setMenu(current);else setNotice('Le menu de ce panier a changé ou n’est plus publié. Le panier est conservé; rechargez le service depuis le menu avant de modifier la commande.');}).catch(()=>setNotice('Le menu de ce panier ne peut pas être vérifié actuellement. Les lignes restent conservées.'));}
    clientApi('client/me').then(() => {
      setSession(true);
      clientApi<DeliveryOptions>('client/delivery-options').then(options=>{setDeliveryOptions(options);setDelivery(value=>({...value,recipientName:options.recipientName,contactPhone:options.contactPhone,dropoffPoint:options.zones[0]?.name??''}));}).catch(()=>setNotice('Les options de livraison ne peuvent pas être chargées pour le moment.'));
    }).catch(() => setSession(false));
  }, []);

  const estimate = items.reduce((sum, item) => sum + (item.unitEstimate ?? Number(item.price.amount)) * item.quantity, 0);
  function change(index: number, quantity: number) {
    persist(items.map((item, i) => i === index ? { ...item, quantity: Math.min(100, quantity) } : item).filter(item => item.quantity > 0));
  }
  function remove(index: number) { persist(items.filter((_, i) => i !== index)); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setError(''); setBusy(true);
    try {
      const first=items[0];
      if (!first?.menuVersionId||!first.serviceCode||!first.businessDate) throw new Error('Ce panier ancien ne précise pas son service. Videz-le puis ajoutez de nouveau les articles depuis le menu.');
      if(items.some(item=>item.menuVersionId!==first.menuVersionId||item.serviceCode!==first.serviceCode||item.businessDate!==first.businessDate))throw new Error('Le panier contient plusieurs services ou versions. Gardez un seul menu avant de commander.');
      if (!serviceMode) throw new Error('Choisissez comment vous souhaitez recevoir votre repas.');
      if(serviceMode==='DELIVERY'&&!deliveryOptions?.available)throw new Error('La livraison sur le campus n’est pas disponible actuellement.');
      if(serviceMode==='DELIVERY'&&(!delivery.recipientName.trim()||!delivery.contactPhone.trim()||!delivery.dropoffPoint||!delivery.requestedDeliveryTime))throw new Error('Renseignez le destinataire, le téléphone, le point de remise et l’heure souhaitée.');
      const currency = items[0]?.price.currency;
      if (items.some(item => item.price.currency !== currency)) throw new Error('Un même panier ne peut pas mélanger plusieurs devises.');
      const attempt = getOrderAttempt(sessionStorage, {
        menuVersionId: first.menuVersionId, serviceCode:first.serviceCode,businessDate:first.businessDate,serviceMode, currency: currency!, ...(acceptUnitPrice?{acceptUnitPrice:true}:{}), ...(serviceMode==='DELIVERY'?{delivery:{recipientName:delivery.recipientName,contactPhone:delivery.contactPhone,dropoffPoint:delivery.dropoffPoint,requestedDeliveryTime:delivery.requestedDeliveryTime,...(delivery.instructions?{instructions:delivery.instructions}:{})}}:{}),
        items: items.map(item => ({ productId: item.productId, quantity: item.quantity, ...(item.variant ? { variant: item.variant } : {}), optionSelections: item.optionSelections ?? [] })),
      }, () => crypto.randomUUID());
      const result = await clientApi<OrderResult>('client/orders', { method: 'POST', idempotencyKey: attempt.key, body: attempt.payload as OrderAttemptPayload });
      setOrder(result);
      setNeedsUnitConsent(false);
      setAcceptUnitPrice(false);
      invalidateOrderAttempt(sessionStorage);
      localStorage.removeItem('jami_cart');
      setItems([]);
    } catch (cause) {
      // Retain the attempt key: an identical retry must replay the same POST.
      if(cause instanceof ApiError&&cause.code==='SUBSCRIPTION_RIGHT_UNAVAILABLE'){setNeedsUnitConsent(true);setAcceptUnitPrice(false);}
      setError(cause instanceof Error ? cause.message : 'La commande n’a pas abouti.');
    } finally { submitting.current = false; setBusy(false); }
  }

  const provenance=items[0];
  return <main className="page-wrap"><PageIntro eyebrow="VOTRE SÉLECTION" title="Votre panier" description="Le total affiché est une estimation. Le serveur revalide tarifs, choix et disponibilités avant la commande." />{provenance?.serviceCode&&<p className="form-note">Menu {provenance.serviceCode==="BREAKFAST"?"Petit-déjeuner":provenance.serviceCode==="DINNER"?"Dîner":"Déjeuner"} · {provenance.businessDate}</p>}
    {order ? <section className="empty-card"><h2>{Number(order.totalAmount)===0?'Repas couvert par votre abonnement':'Commande reçue'}</h2><p>Référence : {order.number}</p><div className="order-cost-breakdown">{order.lines.filter(line=>line.meal).map((line,index)=><Fragment key={`meal-${index}`}>{line.coverageQuantity>0&&<p>Repas couvert par votre abonnement ({line.coverageQuantity}) <strong>Inclus</strong></p>}{line.quantity>line.coverageQuantity&&<p>Repas à l’unité ({line.quantity-line.coverageQuantity}) <strong>{Math.max(0,line.amountDue-line.supplementAmount).toLocaleString('fr-FR')} {order.currency}</strong></p>}</Fragment>)}{(order.lines.some(line=>line.categoryCode==='SUPPLEMENT')||order.lines.some(line=>line.supplementAmount>0))&&<p>Suppléments <strong>{(order.lines.filter(line=>line.categoryCode==='SUPPLEMENT').reduce((sum,line)=>sum+line.amountDue,0)+order.lines.filter(line=>line.meal).reduce((sum,line)=>sum+line.supplementAmount,0)).toLocaleString('fr-FR')} {order.currency}</strong></p>}{order.lines.some(line=>line.categoryCode==='BOISSON')&&<p>Boissons <strong>{order.lines.filter(line=>line.categoryCode==='BOISSON').reduce((sum,line)=>sum+line.amountDue,0).toLocaleString('fr-FR')} {order.currency}</strong></p>}{order.lines.some(line=>!line.meal&&line.categoryCode!=='SUPPLEMENT'&&line.categoryCode!=='BOISSON')&&<p>Autres articles <strong>{order.lines.filter(line=>!line.meal&&line.categoryCode!=='SUPPLEMENT'&&line.categoryCode!=='BOISSON').reduce((sum,line)=>sum+line.amountDue,0).toLocaleString('fr-FR')} {order.currency}</strong></p>}{serviceMode==='DELIVERY'&&<p>Livraison <strong>Gratuite · 0 CDF</strong></p>}<p className="order-cost-total">À payer <strong>{Number(order.totalAmount).toLocaleString('fr-FR')} {order.currency}</strong></p></div>{order.status==='CONFIRMED'?<p>Votre commande est confirmée et envoyée en cuisine. Aucun passage à la caisse n’est nécessaire.</p>:<p>{serviceMode==='DELIVERY'?'Votre livraison attend le règlement du seul montant restant.':'Présentez-vous à la caisse pour régler uniquement le solde affiché.'}</p>}<Link className="button button-dark" href="/orders">Voir mes commandes</Link></section>
      : items.length === 0 ? <EmptyCard iconName="Utensils" title="Votre panier est encore vide" text="Un bon repas commence par un petit tour au menu." action={<Link className="button button-dark" href="/menu">Explorer le menu <ArrowRight size={16} /></Link>} />
        : <form className="cart-panel" onSubmit={submit}><section className="data-list">{items.map((item, index) => <article className="data-row cart-custom-line" key={item.lineId}><div className="cart-custom-info"><b>{item.name}</b><small>{Number(item.price.amount).toLocaleString('fr-FR')} {item.price.currency} · prix de base</small>{item.variantLabel && <small>{item.variantLabel}</small>}{item.supplementsLabel && <small className="cart-addon-label">Suppléments : {item.supplementsLabel}</small>}<button type="button" className="cart-remove" onClick={() => remove(index)}>Retirer</button></div><div className="quantity-control"><button type="button" onClick={() => change(index, item.quantity - 1)} aria-label="Réduire">−</button><span>{item.quantity}</span><button type="button" onClick={() => change(index, item.quantity + 1)} aria-label="Augmenter">+</button></div><strong>{((item.unitEstimate ?? Number(item.price.amount)) * item.quantity).toLocaleString('fr-FR')} {item.price.currency}</strong></article>)}</section>
          <p className="cart-estimate">Estimation : <b>{estimate.toLocaleString('fr-FR')} {items[0]?.price.currency}</b></p>
          <label>Comment souhaitez-vous recevoir votre repas ?<select required value={serviceMode} onChange={event => { setServiceMode(event.target.value as 'DINE_IN' | 'TAKEAWAY'|'DELIVERY'|''); invalidateOrderAttempt(sessionStorage); }}><option value="">Choisir un mode de service</option><option value="TAKEAWAY">À emporter</option><option value="DINE_IN">Sur place</option><option value="DELIVERY">Livraison sur le campus</option></select></label>
          {serviceMode==='DELIVERY'&&<fieldset className="cart-delivery-fields"><legend>Livraison sur le campus</legend>{!deliveryOptions?.available?<p className="form-note">{deliveryOptions?.reason==='DELIVERY_SETTING_NOT_VALIDATED'?'La Responsable doit valider le réglage de livraison.':deliveryOptions?.reason==='NO_ACTIVE_DROPOFF_POINT'?'Aucun point de remise sur le campus n’est actuellement actif.':'La livraison sur le campus n’est pas disponible actuellement.'}</p>:<><label>Destinataire<input required maxLength={120} value={delivery.recipientName} onChange={event=>setDelivery(value=>({...value,recipientName:event.target.value}))}/></label><label>Téléphone de contact<input required maxLength={30} value={delivery.contactPhone} onChange={event=>setDelivery(value=>({...value,contactPhone:event.target.value}))}/></label><label>Point de remise<select required value={delivery.dropoffPoint} onChange={event=>{setDelivery(value=>({...value,dropoffPoint:event.target.value}));invalidateOrderAttempt(sessionStorage);}}>{deliveryOptions.zones.map(zone=><option key={zone.name} value={zone.name}>{zone.name}</option>)}</select></label><label>Heure souhaitée<input required type="time" value={delivery.requestedDeliveryTime} onChange={event=>setDelivery(value=>({...value,requestedDeliveryTime:event.target.value}))}/></label><label>Instructions pour le livreur<textarea maxLength={500} value={delivery.instructions} onChange={event=>setDelivery(value=>({...value,instructions:event.target.value}))}/></label><p className="form-note">Livraison <strong>GRATUITE</strong> · Frais de livraison : <strong>0 CDF</strong>{deliveryOptions.cutoffTime?` · Commande avant ${deliveryOptions.cutoffTime}`:''}</p></>}</fieldset>}
          {notice && <p className="form-note" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}{needsUnitConsent&&<label className="form-note"><input type="checkbox" checked={acceptUnitPrice} onChange={event=>{setAcceptUnitPrice(event.target.checked);setError('');}}/> J’accepte de commander le repas au tarif unitaire affiché, sans utiliser un droit d’abonnement indisponible.</label>}{!session && <p className="form-note">Connectez-vous pour enregistrer votre commande et la retrouver dans Mon JAMI FOOD.</p>}
          <p className="form-note">Le paiement et la commande sont confirmés à la caisse après revalidation de votre compte et des tarifs par le serveur.</p><button className="button button-dark" type="submit" disabled={busy || !session || (serviceMode==='DELIVERY'&&!deliveryOptions?.available)}>{busy ? 'Validation…' : session ? 'Valider la commande' : 'Se connecter pour commander'}</button>{!session && <Link className="text-link" href="/login">Se connecter <ArrowRight size={16} /></Link>}
        </form>}
  </main>;
}
