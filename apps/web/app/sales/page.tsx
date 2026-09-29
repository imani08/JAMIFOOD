'use client';
import { FormEvent, useState } from 'react';
import { Heading, Loading, useData } from '../../components/common';
import { date, money } from '../../lib/api';

type Sale={id:string;number:string;sourceChannel:'POS'|'WHATSAPP';status:string;businessDate:string;createdAt:string;totalAmount:string;coveredAmount:string;currency:string;cashierId:string|null;handoverAt:string|null;serviceCode:string|null;client:{firstName:string;lastName:string;ulcNumber:string|null}|null;cashier:{firstName:string;lastName:string;username:string}|null;items:{productSnapshot:{name?:string};quantity:string}[];payments:{method:string;amountDue:string;status:string;cashSessionId:string;confirmedAt:string|null;cashSession:{cashRegister:{code:string;label:string}}}[]};
type Filters={from:string;to:string;q:string;status:string;sourceChannel:string;customerType:string;serviceCode:string;paymentMethod:string;cashierId:string;cashSessionId:string};
type SalesResult={orders:Sale[];total:number};
type Selectors={cashiers:{id:string;firstName:string;lastName:string;username:string}[];sessions:{id:string;openedAt:string;cashierId:string;cashRegister:{code:string;label:string}}[]};
function today(){return new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Kinshasa'});}
const emptyFilters=():Filters=>({from:today(),to:today(),q:'',status:'',sourceChannel:'',customerType:'',serviceCode:'',paymentMethod:'',cashierId:'',cashSessionId:''});
export default function Sales(){
  const [filters,setFilters]=useState<Filters>(emptyFilters),[applied,setApplied]=useState<Filters>(emptyFilters),[page,setPage]=useState(1);
  const selectors=useData<Selectors>('/orders/supervision-filters');
  const params=new URLSearchParams({page:String(page),limit:'25'});
  for(const [key,value] of Object.entries(applied))if(value)params.set(key,value);
  const q=useData<SalesResult>('/orders/supervision?'+params.toString());
  function submit(event:FormEvent){event.preventDefault();setPage(1);setApplied(filters);}
  const pages=Math.max(1,Math.ceil((q.data?.total??0)/25));
  return <>
    <Heading title="Supervision des ventes et commandes" subtitle="Recherchez les opérations POS et les commandes abonnés, avec encaissements et caisse associée."/>
    <section className="card"><form onSubmit={submit} className="form-grid">
      <label>Du<input type="date" value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})} required/></label>
      <label>Au<input type="date" value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})} required/></label>
      <label>Numéro / abonné / matricule<input value={filters.q} onChange={e=>setFilters({...filters,q:e.target.value})} placeholder="Recherche" maxLength={100}/></label>
      <label>Statut<select value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">Tous</option>{[['RECEIVED','Reçue'],['CONFIRMED','Confirmée'],['READY','À retirer'],['SERVED','Retirée / servie'],['CANCELLED','Annulée']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Origine<select value={filters.sourceChannel} onChange={e=>setFilters({...filters,sourceChannel:e.target.value})}><option value="">Toutes</option><option value="POS">POS</option><option value="WHATSAPP">WhatsApp</option></select></label>
      <label>Client<select value={filters.customerType} onChange={e=>setFilters({...filters,customerType:e.target.value})}><option value="">Tous</option><option value="SUBSCRIBER">Abonné / identifié</option><option value="ANONYMOUS">Vente anonyme</option></select></label>
      <label>Service<select value={filters.serviceCode} onChange={e=>setFilters({...filters,serviceCode:e.target.value})}><option value="">Tous</option><option value="BREAKFAST">Petit-déjeuner</option><option value="LUNCH">Déjeuner</option><option value="DINNER">Dîner</option></select></label>
      <label>Paiement<select value={filters.paymentMethod} onChange={e=>setFilters({...filters,paymentMethod:e.target.value})}><option value="">Tous</option>{['CASH','MPESA','ORANGE_MONEY','AIRTEL_MONEY','CARD','TRANSFER'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Caissier<select value={filters.cashierId} onChange={e=>setFilters({...filters,cashierId:e.target.value})}><option value="">Tous</option>{selectors.data?.cashiers.map(item=><option key={item.id} value={item.id}>{item.firstName} {item.lastName} · {item.username}</option>)}</select></label>
      <label>Session / caisse<select value={filters.cashSessionId} onChange={e=>setFilters({...filters,cashSessionId:e.target.value})}><option value="">Toutes</option>{selectors.data?.sessions.map(item=><option key={item.id} value={item.id}>{item.cashRegister.label} · {item.cashRegister.code} · {date(item.openedAt)}</option>)}</select></label>
      <button className="primary" type="submit">Appliquer les filtres</button>
    </form><Loading loading={selectors.isLoading} error={selectors.error}/></section>
    <Loading loading={q.isLoading} error={q.error}/>
    <section className="card table-wrap"><table><thead><tr><th>Date / remise</th><th>Opération</th><th>Caissier</th><th>Articles</th><th>Total commercial</th><th>Couverture</th><th>Paiements / caisse</th></tr></thead><tbody>{q.data?.orders.map(s=><tr key={s.id}><td>{date(s.handoverAt??s.createdAt)}</td><td><strong>{s.number}</strong><br/>{s.sourceChannel==='WHATSAPP'?'WhatsApp · retrait':'POS'} · {s.status}<br/>{s.client?`${s.client.firstName} ${s.client.lastName}${s.client.ulcNumber?` · ${s.client.ulcNumber}`:''}`:'Vente anonyme'} · {s.serviceCode??'—'}</td><td>{s.cashier?`${s.cashier.firstName} ${s.cashier.lastName}`:s.cashierId??'—'}</td><td>{s.items.map((item,index)=><span key={`${s.id}-${index}`}>{item.productSnapshot.name??'Article'} × {item.quantity}{index<s.items.length-1?' · ':''}</span>)}</td><td>{money(s.totalAmount,s.currency)}</td><td>{money(s.coveredAmount,s.currency)}</td><td>{s.payments.length?s.payments.map((p,index)=><span key={`${s.id}-${p.cashSessionId}-${index}`}>{p.method}: {money(p.amountDue,s.currency)} · {p.cashSession.cashRegister.label} ({p.cashSession.cashRegister.code}) · {p.status}<br/></span>):'Aucun encaissement'}</td></tr>)}</tbody></table>{!q.isLoading&&!q.data?.orders.length&&<p className="empty">Aucune opération ne correspond à cette période.</p>}</section>
    {q.data&&<nav className="actions section" aria-label="Pagination des ventes"><button className="secondary" disabled={page<=1} onClick={()=>setPage(page-1)}>Précédent</button><span>Page {page} / {pages} · {q.data.total} opération(s)</span><button className="secondary" disabled={page>=pages} onClick={()=>setPage(page+1)}>Suivant</button></nav>}
  </>;
}
