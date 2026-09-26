'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ShoppingBag } from '../icons';
import { EmptyCard, PageIntro } from '../ui';

export default function CartPage() { const [count,setCount]=useState(0); useEffect(()=>{try{setCount(JSON.parse(localStorage.getItem('jami_cart')??'[]').length);}catch{setCount(0);}},[]); return <main className="page-wrap"><PageIntro eyebrow="VOTRE SÉLECTION" title="Votre panier" description="Le panier est une estimation locale. Le prix final sera toujours recalculé par le serveur avant toute commande."/>{count ? <EmptyCard iconName="Utensils" title="Votre sélection est prête" text="Les produits du panier seront revalidés par le restaurant avant la commande." action={<Link className="button button-dark" href="/menu">Retour au menu <ArrowRight size={16}/></Link>}/> : <EmptyCard iconName="Utensils" title="Votre panier est encore vide" text="Un bon repas commence par un petit tour au menu." action={<Link className="button button-dark" href="/menu">Explorer le menu <ArrowRight size={16}/></Link>}/>}</main>; }
