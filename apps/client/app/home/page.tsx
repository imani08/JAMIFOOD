'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, MapPin, QrCode, Sparkles, Utensils } from '../icons';
import { clientApi, productImageUrl } from '../lib/api';

type Offers={meal:null|{name:string;description:string|null;composition:string|null;amount:string;currency:string};supplements:Array<{id:string;name:string;amount:string;currency:string;saleUnit:string}>;plans:Array<{code:string;name:string;price:string|null;currency:string|null;services:unknown;deliveryIncluded:boolean}>};
type Menu={businessDate:string;serviceCode:string;items:Array<{id:string;name:string;imageUrl:string|null;description:string|null;remaining:number;price:{amount:string;currency:string}}>};
type CartLine={productId:string;name:string;quantity:number;price:{amount:string;currency:string}};

const serviceLabels:Record<string,string>={BREAKFAST:'Petit-déjeuner',LUNCH:'Déjeuner',DINNER:'Dîner',MAIN:'Repas'};
const shortcuts=[{href:'/menu',label:'Le menu',icon:'01'},{href:'/account/subscription',label:'Abonnements',icon:'02'},{href:'/account',label:'Mon espace',icon:'03'}];

export default function RestaurantHomePage(){
  const[offers,setOffers]=useState<Offers|null>(null);const[menu,setMenu]=useState<Menu|null>(null);const[added,setAdded]=useState('');
  useEffect(()=>{clientApi<Offers>('menus/commercial-offers').then(setOffers).catch(()=>setOffers(null));clientApi<Menu|null>('menus/public').then(setMenu).catch(()=>setMenu(null));},[]);
  const formatPrice=(amount:string,currency:string)=>`${Number(amount).toLocaleString('fr-FR')} ${currency==='CDF'?'FC':currency}`;
  const serviceNames=(value:unknown)=>Array.isArray(value)?value.map(item=>serviceLabels[String(item)]??String(item)).filter(Boolean):[];
  function addSupplement(item:Offers['supplements'][number]){let cart:CartLine[]=[];try{cart=JSON.parse(localStorage.getItem('jami_cart')??'[]') as CartLine[]}catch{}const line=cart.find(row=>row.productId===item.id);if(line)line.quantity+=1;else cart.push({productId:item.id,name:item.name,quantity:1,price:{amount:item.amount,currency:item.currency}});localStorage.setItem('jami_cart',JSON.stringify(cart));setAdded(item.name);window.setTimeout(()=>setAdded(''),1800);}
  const dishes=menu?.items.slice(0,3)??[];const heroPhoto=productImageUrl(menu?.items.find(item=>productImageUrl(item.imageUrl))?.imageUrl);
  return <main className="minimal-home">
    <section className="mh-hero">
      <div className="mh-hero-copy"><span className="mh-kicker"><i/> RESTAURANT DU CAMPUS · ULC</span><h1>Le goût du campus,<br/><em>à votre rythme.</em></h1><p>Découvrez le menu publié, commandez simplement et retrouvez votre compte JAMI FOOD au même endroit.</p><div className="mh-actions"><Link className="mh-button" href="/menu">Explorer le menu <ArrowRight size={16}/></Link><Link className="mh-link" href="/account">Mon espace <ArrowRight size={15}/></Link></div><div className="mh-location"><MapPin size={15}/> Université Loyola du Congo</div></div>
      <div className="mh-hero-visual" style={heroPhoto?{backgroundImage:`url("${heroPhoto}")`}:undefined}><div className="mh-visual-shade"/><div className="mh-visual-stamp"><span>JAMI</span><b>FOOD</b><i>LE GOÛT DU CAMPUS</i></div>{menu&&<div className="mh-menu-badge"><span>AU MENU</span><b>{serviceLabels[menu.serviceCode]??menu.serviceCode}</b></div>}</div>
      {offers?.meal&&<div className="mh-feature-card"><span>REPAS ÉTUDIANT</span><b>{offers.meal.name}</b><strong>{formatPrice(offers.meal.amount,offers.meal.currency)}</strong><Link href="/menu" aria-label="Voir le menu"><ArrowRight size={17}/></Link></div>}
    </section>

    <nav className="mh-shortcuts" aria-label="Accès rapides">{shortcuts.map((item)=><Link href={item.href} key={item.href}><span>{item.icon}</span><b>{item.label}</b><ArrowRight size={16}/></Link>)}</nav>

    <section className="mh-menu-section" aria-labelledby="mh-menu-title"><header className="mh-section-heading"><div><span className="mh-kicker">PLATS ET TARIFS PUBLIÉS</span><h2 id="mh-menu-title">À découvrir aujourd’hui</h2></div><Link className="mh-link" href="/menu">Tout le menu <ArrowRight size={15}/></Link></header>
      {menu&&dishes.length>0?<div className="mh-dishes">{dishes.map((item,index)=><Link href="/menu" className="mh-dish" key={item.id}><div className="mh-dish-photo">{productImageUrl(item.imageUrl)?<Image src={productImageUrl(item.imageUrl)!} alt="" fill sizes="(max-width: 700px) 82vw, 30vw"/>:<span className="mh-dish-placeholder"><Utensils size={26}/></span>}<span className="mh-dish-number">0{index+1}</span></div><div className="mh-dish-info"><div><h3>{item.name}</h3>{item.description&&<p>{item.description}</p>}</div><strong>{formatPrice(item.price.amount,item.price.currency)}</strong></div></Link>)}</div>:<div className="mh-empty-menu"><span><Utensils size={20}/></span><p>{menu?'Aucun plat disponible dans ce menu pour le moment.':'Le menu du jour n’est pas encore disponible.'}</p><Link className="mh-link" href="/menu">Consulter le menu <ArrowRight size={15}/></Link></div>}
    </section>

    {!!offers?.plans.length&&<section className="mh-plans" aria-labelledby="mh-plans-title"><div className="mh-plans-top"><div><span className="mh-kicker">PENSÉES POUR VOTRE QUOTIDIEN</span><h2 id="mh-plans-title">Les formules JAMI FOOD</h2><p>Choisissez la formule qui correspond à votre rythme.</p></div><Link className="mh-button mh-button-light" href="/account/subscription">Voir mon abonnement <ArrowRight size={15}/></Link></div><div className="mh-plan-list">{offers.plans.map(plan=><article className="mh-plan" key={plan.code}><span>{plan.name}</span><strong>{plan.price&&plan.currency?formatPrice(plan.price,plan.currency):'Sur devis'}</strong>{serviceNames(plan.services).length>0&&<small>{serviceNames(plan.services).join(' · ')}</small>}{plan.deliveryIncluded&&<small>Livraison incluse</small>}</article>)}</div><p className="mh-plan-note">Chaque droit couvre un repas du service prévu. Les suppléments sont facturés séparément.</p></section>}

    {!!offers?.supplements.length&&<section className="mh-supplements"><header className="mh-section-heading"><div><span className="mh-kicker">À LA CARTE</span><h2>Un supplément ?</h2></div><Link className="mh-link" href="/cart">Voir le panier <ArrowRight size={15}/></Link></header><div className="mh-supplement-list">{offers.supplements.map(item=><article key={item.id}><div><h3>{item.name}</h3><span>{formatPrice(item.amount,item.currency)} / {item.saleUnit}</span></div><button type="button" onClick={()=>addSupplement(item)} aria-label={`Ajouter ${item.name}`}>+</button></article>)}</div>{added&&<p role="status" className="mh-added">{added} ajouté au panier · <Link href="/cart">Voir</Link></p>}</section>}

    <section className="mh-last-call"><div><Sparkles size={18}/><span>FAIT POUR LA VIE SUR LE CAMPUS</span></div><h2>Une pause bien méritée.</h2><Link className="mh-button" href="/menu">Voir le menu <ArrowRight size={16}/></Link><Link className="mh-qr-link" href="/account/qr"><QrCode size={16}/> Mon QR JAMI</Link></section>
  </main>;
}
