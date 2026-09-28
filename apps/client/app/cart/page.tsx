'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowRight } from '../icons';
import { clientApi } from '../lib/api';
import { EmptyCard, PageIntro } from '../ui';
import { getOrderAttempt, invalidateOrderAttempt, OrderAttemptPayload } from './idempotency';

type Selection = { groupId: string; optionIds: string[] };
type CartLine = {
  lineId: string; productId: string; name: string; quantity: number;
  price: { amount: string; currency: string }; variant?: string;
  optionSelections?: Selection[]; variantLabel?: string; supplementsLabel?: string; unitEstimate?: number;
};
type Menu = {
  version: number; menuVersionId: string;
  items: Array<{ id: string; remaining: number; price: { amount: string; currency: string }; variants: string[] | null; optionGroups?: Array<{ id:string; type:'VARIANT'|'SUPPLEMENT'; options: Array<{ id:string; priceDelta:string; linkedProductId: string | null }> }> }>;
};
type Offers = { supplements: Array<{ id: string; name:string; amount:string; currency:string }> };
const CART_MENU_VERSION_KEY = 'jami-cart-menu-version';

export default function CartPage() {
  const submitting = useRef(false);
  const [items, setItems] = useState<CartLine[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [serviceMode, setServiceMode] = useState<'DINE_IN' | 'TAKEAWAY'>('TAKEAWAY');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState('');
  const [session, setSession] = useState(false);

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

    clientApi<Menu | null>('menus/public').then(async current => {
      setMenu(current);
      if (!current) return;
      const previousVersion = localStorage.getItem(CART_MENU_VERSION_KEY);
      if (!previousVersion) {
        localStorage.setItem(CART_MENU_VERSION_KEY, current.menuVersionId);
        return;
      }
      if (previousVersion === current.menuVersionId) return;

      invalidateOrderAttempt(sessionStorage);
      let offersById = new Map<string, Offers['supplements'][number]>();
      try {
        const offers = await clientApi<Offers>('menus/commercial-offers');
        offersById = new Map(offers.supplements.map(item => [item.id, item]));
      } catch { /* Le serveur revalidera toute ligne dont l’offre n’est pas publiée. */ }
      const available = new Map(current.items.map(item => [item.id, item.remaining]));
      const menuById = new Map(current.items.map(item => [item.id, item]));
      const validIds = new Set(available.keys());
      for (const item of current.items) for (const group of item.optionGroups ?? []) for (const option of group.options) if (option.linkedProductId) validIds.add(option.linkedProductId);
      for (const id of offersById.keys()) validIds.add(id);

      const latestCart = (JSON.parse(localStorage.getItem('jami_cart') ?? '[]') as Array<Partial<CartLine> & {productId:string;name:string;quantity:number;price:{amount:string;currency:string}}>).map((line,index)=>({...line,lineId:line.lineId??`${line.productId}:legacy:${index}`,optionSelections:line.optionSelections??[],unitEstimate:line.unitEstimate??Number(line.price.amount)})) as CartLine[];
      let changed = false;
      const next = latestCart.flatMap(line => {
          if (!validIds.has(line.productId)) { changed = true; return []; }
          const item=menuById.get(line.productId);
          const offer=offersById.get(line.productId);
          if(item){
            if(line.variant&&(!item.variants||!item.variants.includes(line.variant))){changed=true;return [];}
            const selections=line.optionSelections??[];
            const validSelections=selections.every(selection=>{const group=item.optionGroups?.find(value=>value.id===selection.groupId);return !!group&&selection.optionIds.every(id=>group.options.some(option=>option.id===id));});
            if(!validSelections){changed=true;return [];}
          }
          const remaining = available.get(line.productId);
          const quantity = remaining === undefined ? line.quantity : Math.min(line.quantity, remaining);
          if (quantity < 1) { changed = true; return []; }
          if (quantity !== line.quantity) changed = true;
          const basePrice=item?.price??(offer?{amount:offer.amount,currency:offer.currency}:line.price);
          const supplements=(line.optionSelections??[]).flatMap(selection=>{const group=item?.optionGroups?.find(value=>value.id===selection.groupId);return group?.type==='SUPPLEMENT'?selection.optionIds.map(id=>Number(group.options.find(option=>option.id===id)?.priceDelta??0)):[];}).reduce((sum,amount)=>sum+amount,0);
          const unitEstimate=Number(basePrice.amount)+supplements;
          if(basePrice.amount!==line.price.amount||basePrice.currency!==line.price.currency||unitEstimate!==line.unitEstimate)changed=true;
          return [{ ...line, quantity, price:basePrice, unitEstimate }];
      });
      setItems(next);
      localStorage.setItem('jami_cart', JSON.stringify(next));
      if (changed) setNotice('Le menu a changé : les lignes et quantités indisponibles ont été retirées ou ajustées. Vérifiez votre panier avant de commander.');
      else setNotice('Le menu a changé. Les disponibilités seront revérifiées lors de la validation.');
      localStorage.setItem(CART_MENU_VERSION_KEY, current.menuVersionId);
    }).catch(() => {});

    clientApi('client/me').then(() => setSession(true)).catch(() => setSession(false));
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
      if (!menu) throw new Error('Le menu du jour n’est plus disponible.');
      const currency = items[0]?.price.currency;
      if (items.some(item => item.price.currency !== currency)) throw new Error('Un même panier ne peut pas mélanger plusieurs devises.');
      const attempt = getOrderAttempt(sessionStorage, {
        menuVersionId: menu.menuVersionId, serviceMode, currency: currency!,
        items: items.map(item => ({ productId: item.productId, quantity: item.quantity, ...(item.variant ? { variant: item.variant } : {}), optionSelections: item.optionSelections ?? [] })),
      }, () => crypto.randomUUID());
      const result = await clientApi<{ id: string; number: string }>('client/orders', { method: 'POST', idempotencyKey: attempt.key, body: attempt.payload as OrderAttemptPayload });
      setOrder(result.number);
      invalidateOrderAttempt(sessionStorage);
      localStorage.removeItem('jami_cart');
      localStorage.removeItem(CART_MENU_VERSION_KEY);
      setItems([]);
    } catch (cause) {
      // Retain the attempt key: an identical retry must replay the same POST.
      setError(cause instanceof Error ? cause.message : 'La commande n’a pas abouti.');
    } finally { submitting.current = false; setBusy(false); }
  }

  return <main className="page-wrap"><PageIntro eyebrow="VOTRE SÉLECTION" title="Votre panier" description="Le total affiché est une estimation. Le serveur revalide tarifs, choix et disponibilités avant la commande." />
    {order ? <section className="empty-card"><h2>Commande reçue</h2><p>Référence : {order}. Présentez-vous à la caisse pour le règlement et la confirmation.</p><Link className="button button-dark" href="/orders">Voir mes commandes</Link></section>
      : items.length === 0 ? <EmptyCard iconName="Utensils" title="Votre panier est encore vide" text="Un bon repas commence par un petit tour au menu." action={<Link className="button button-dark" href="/menu">Explorer le menu <ArrowRight size={16} /></Link>} />
        : <form className="cart-panel" onSubmit={submit}><section className="data-list">{items.map((item, index) => <article className="data-row cart-custom-line" key={item.lineId}><div className="cart-custom-info"><b>{item.name}</b><small>{Number(item.price.amount).toLocaleString('fr-FR')} {item.price.currency} · prix de base</small>{item.variantLabel && <small>{item.variantLabel}</small>}{item.supplementsLabel && <small className="cart-addon-label">Suppléments : {item.supplementsLabel}</small>}<button type="button" className="cart-remove" onClick={() => remove(index)}>Retirer</button></div><div className="quantity-control"><button type="button" onClick={() => change(index, item.quantity - 1)} aria-label="Réduire">−</button><span>{item.quantity}</span><button type="button" onClick={() => change(index, item.quantity + 1)} aria-label="Augmenter">+</button></div><strong>{((item.unitEstimate ?? Number(item.price.amount)) * item.quantity).toLocaleString('fr-FR')} {item.price.currency}</strong></article>)}</section>
          <p className="cart-estimate">Estimation : <b>{estimate.toLocaleString('fr-FR')} {items[0]?.price.currency}</b></p>
          <label>Service<select value={serviceMode} onChange={event => { setServiceMode(event.target.value as 'DINE_IN' | 'TAKEAWAY'); invalidateOrderAttempt(sessionStorage); }}><option value="TAKEAWAY">À emporter</option><option value="DINE_IN">Sur place</option></select></label>
          {notice && <p className="form-note" role="status">{notice}</p>}{error && <p className="form-error" role="alert">{error}</p>}{!session && <p className="form-note">Connectez-vous pour enregistrer votre commande et la retrouver dans Mon JAMI FOOD.</p>}
          <p className="form-note">Le paiement et la commande sont confirmés à la caisse après revalidation de votre compte et des tarifs par le serveur.</p><button className="button button-dark" type="submit" disabled={busy || !session}>{busy ? 'Validation…' : session ? 'Valider la commande' : 'Se connecter pour commander'}</button>{!session && <Link className="text-link" href="/login">Se connecter <ArrowRight size={16} /></Link>}
        </form>}
  </main>;
}
