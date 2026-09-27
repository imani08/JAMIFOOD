'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clientApi } from '../lib/api';
import { ArrowRight } from '../icons';
import { EmptyCard, PageIntro } from '../ui';

type Row=Record<string,unknown>;
const titles:Record<string,string>={subscriptions:'Mon abonnement',rights:'Mes droits',orders:'Mes commandes',payments:'Mes paiements',receipts:'Mes reçus',deliveries:'Mes livraisons',activity:'Mon historique'};
function display(value:unknown):string { if(value instanceof Date)return value.toLocaleDateString('fr-FR');if(typeof value==='string'&&/^\d{4}-\d\d-\d\d/.test(value))return new Date(value).toLocaleDateString('fr-FR');if(typeof value==='object'&&value!==null&&'name'in value)return String((value as {name:unknown}).name);return String(value??'—'); }
 export function AccountDataView({section}:{section:string}){
 const [rows,setRows]=useState<Row[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const endpoint=section==='subscriptions'?'subscriptions':section;
 useEffect(()=>{clientApi<Row[]>(`client/${endpoint}`).then(setRows).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[endpoint]);
 return <main className="page-wrap"><PageIntro eyebrow="MON JAMI FOOD" title={titles[section]??section} description="Informations récupérées depuis votre compte JAMI FOOD."/>{loading?<p role="status">Chargement…</p>:error?<EmptyCard title="Connexion nécessaire" text={error} action={<Link className="button button-dark" href="/login">Se connecter</Link>}/>:rows.length===0?<EmptyCard title="Aucune donnée pour le moment" text="Les informations apparaîtront ici dès qu’elles seront disponibles sur votre compte." action={<Link className="text-link" href="/account">Retour à Mon JAMI FOOD <ArrowRight size={16}/></Link>}/>:<section className="data-list">{rows.map((row,index)=>{const orderId=typeof row.id==='string'&&section==='orders'?row.id:null;const primary=String(row.number??row.planVersion??row.action??row.serviceCode??row.status??'Activité');const date=display(row.createdAt??row.businessDate??row.startsOn);return <article className="data-row" key={String(row.id??`${primary}-${index}`)}><div><b>{primary}</b><small>{date} · {String(row.status??row.action??'')}</small></div>{row.totalAmount!==undefined&&<strong>{display(row.totalAmount)} {display(row.currency)}</strong>}{orderId&&<Link className="text-link" href={`/orders/${orderId}`}>Détails <ArrowRight size={15}/></Link>}</article>})}</section>}</main>;
}
