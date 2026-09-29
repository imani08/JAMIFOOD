'use client';

import Link from 'next/link';
import { Heading, Loading, useData } from '../../components/common';
import { date, money } from '../../lib/api';

type Dashboard = {
  date: string;
  orders: { total:number; received:number; confirmed:number; readyForPickup:number; served:number; cancelled:number };
  directSales: { currency:string; amount:string; count:number }[];
  payments: { currency:string; method:string; amount:string; count:number }[];
  servedMeals:number;
  servedSubscribers:number;
  consumedRights:number;
  activeSubscriptions:number;
  expiringSubscriptions:number;
  activeSessions:{id:string;status:string;openedAt:string;cashierId:string;cashier:{firstName:string;lastName:string;username:string}|null;cashRegister:{code:string;label:string}}[];
  publishedMenus:{serviceCode:string;version:number|null}[];
  lowStock:{id:string;code:string;name:string;unit:string;quantity:string;alertThreshold:string}[];
  recentActivity:{id:string;action:string;entityType:string;entityId:string|null;createdAt:string;actor:{firstName:string;lastName:string;username:string}|null}[];
};

const serviceName:Record<string,string>={BREAKFAST:'Petit-déjeuner',LUNCH:'Déjeuner',DINNER:'Dîner'};

export default function ManagerDashboard(){
  const query=useData<Dashboard>('/dashboard/operations');
  const d=query.data;
  return <>
    <Heading title="Pilotage opérationnel" subtitle={d?`Activité du ${d.date} · Données actualisées depuis PostgreSQL.`:'Activité du jour · Indicateurs issus des opérations enregistrées.'}>
      <Link href="/sales" className="secondary">Supervision des ventes</Link>
    </Heading>
    <Loading loading={query.isLoading} error={query.error}/>
    {d&&<>
      <section className="grid metric-grid" aria-label="Indicateurs du jour">
        <Metric title="Commandes aujourd’hui" value={d.orders.total} detail={`${d.orders.received} reçue(s) · ${d.orders.confirmed} confirmée(s)`}/>
        <Metric title="À retirer" value={d.orders.readyForPickup} detail="Commandes WhatsApp prêtes au comptoir" href="/whatsapp-orders"/>
        <Metric title="Repas servis" value={d.servedMeals} detail={`${d.servedSubscribers} abonné(s) · ${d.consumedRights} droit(s) consommé(s)`}/>
        <Metric title="Abonnements actifs" value={d.activeSubscriptions} detail={`${d.expiringSubscriptions} expiration(s) dans les 7 jours`} href="/subscriptions"/>
        <Metric title="Sessions de caisse" value={d.activeSessions.length} detail="Caissiers actuellement affectés" href="/cash"/>
        <Metric title="Commandes annulées" value={d.orders.cancelled} detail="Annulations enregistrées aujourd’hui"/>
      </section>
      <section className="two-columns section">
        <section className="card"><h2>Ventes POS</h2>{d.directSales.length?d.directSales.map(row=><div className="item" key={row.currency}><span>{row.count} vente(s)</span><strong>{money(row.amount,row.currency)}</strong></div>):<p className="empty">Aucune vente POS aujourd’hui.</p>}</section>
        <section className="card"><h2>Encaissements confirmés</h2>{d.payments.length?d.payments.map(row=><div className="item" key={`${row.currency}-${row.method}`}><span>{row.method} · {row.count} paiement(s)</span><strong>{money(row.amount,row.currency)}</strong></div>):<p className="empty">Aucun encaissement confirmé aujourd’hui.</p>}</section>
        <section className="card"><h2>Caisses actives</h2>{d.activeSessions.length?<div className="table-wrap"><table><thead><tr><th>Caissier</th><th>Caisse</th><th>Ouverte depuis</th><th>État</th></tr></thead><tbody>{d.activeSessions.map(session=><tr key={session.id}><td>{session.cashier?`${session.cashier.firstName} ${session.cashier.lastName}`:session.cashierId}</td><td>{session.cashRegister.label} · {session.cashRegister.code}</td><td>{date(session.openedAt)}</td><td>{session.status}</td></tr>)}</tbody></table></div>:<p className="empty">Aucune session ouverte.</p>}<Link className="secondary" href="/cash">Gérer les caisses →</Link></section>
        <section className="card"><h2>Menus publiés aujourd’hui</h2>{d.publishedMenus.length?<div className="list">{d.publishedMenus.map(menu=><div className="item" key={menu.serviceCode}><span>{serviceName[menu.serviceCode]??menu.serviceCode}</span><strong>Version {menu.version??'—'}</strong></div>)}</div>:<p className="empty">Aucun menu publié aujourd’hui.</p>}<Link className="secondary" href="/menus">Consulter les menus →</Link></section>
        <section className="card"><h2>Alertes stock</h2>{d.lowStock.length?<div className="table-wrap"><table><thead><tr><th>Article</th><th>Disponible</th><th>Seuil</th></tr></thead><tbody>{d.lowStock.map(item=><tr key={item.id}><td>{item.name} <small className="muted">{item.code}</small></td><td>{item.quantity} {item.unit}</td><td>{item.alertThreshold} {item.unit}</td></tr>)}</tbody></table></div>:<p className="empty">Aucun article sous le seuil configuré.</p>}<Link className="secondary" href="/stock">Voir le stock →</Link></section>
        <section className="card"><h2>Activité récente</h2>{d.recentActivity.length?<div className="list">{d.recentActivity.map(entry=><div className="item" key={entry.id}><span><strong>{entry.action}</strong><br/><small className="muted">{entry.actor?`${entry.actor.firstName} ${entry.actor.lastName}`:'Système'} · {entry.entityType}</small></span><time className="muted small">{date(entry.createdAt)}</time></div>)}</div>:<p className="empty">Aucune activité enregistrée aujourd’hui.</p>}<Link className="secondary" href="/audit">Consulter le journal d’audit →</Link></section>
      </section>
      <section className="actions section"><Link className="secondary" href="/subscribers">Abonnés</Link><Link className="secondary" href="/subscriptions">Abonnements</Link><Link className="secondary" href="/whatsapp-orders">Commandes WhatsApp à retirer</Link><Link className="secondary" href="/reports">Rapports</Link></section>
    </>}
  </>;
}

function Metric({title,value,detail,href}:{title:string;value:number;detail:string;href?:string}){
  const content=<><span className="metric-title">{title}</span><strong className="metric-value">{value}</strong><span className="metric-detail">{detail}</span>{href&&<span className="metric-action">Voir le détail <span aria-hidden="true">→</span></span>}</>;
  return href?<Link href={href} className="card metric-card metric-card-link">{content}</Link>:<article className="card metric-card">{content}</article>;
}
