'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Wallet, Users, Utensils, Package, ClipboardList, ShieldCheck, Settings, LogOut, CreditCard, CalendarDays, ScanLine } from 'lucide-react';
import { api } from '../lib/api';
type User = { username: string; firstName: string; permissions: string[] };
const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext);
const links = [ ['/', 'Vue d’ensemble', LayoutDashboard, 'reports.read'], ['/pos','Caisse · TPE',CreditCard,'sales.create'], ['/kitchen','Cuisine',Utensils,'kitchen.read'], ['/orders','Commandes',ClipboardList,'orders.read'], ['/clients','Clients',Users,'clients.read'], ['/subscriptions','Abonnements',CalendarDays,'subscriptions.read'], ['/meals','Contrôle des repas',ScanLine,'meal.validate'], ['/cash','Caisses & clôtures',Wallet,'cash.read'], ['/expenses','Dépenses',Wallet,'cash.expense'], ['/stock','Stocks & achats',Package,'stock.read'], ['/reports','Rapports',LayoutDashboard,'reports.read'], ['/audit','Journal d’audit',ShieldCheck,'audit.read'], ['/users','Utilisateurs',Users,'users.read'], ['/settings','Paramètres',Settings,'pricing.read'] ] as const;
function Frame({ children }: { children: ReactNode }) {
  const path = usePathname(), router = useRouter();
  const user = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/auth/me'), retry: false, enabled: path !== '/login' });
  const [online,setOnline]=useState(true);
  useEffect(()=>{ const update=()=>setOnline(navigator.onLine);update();window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{if(user.isError && path!=='/login') router.replace('/login');},[user.isError,path,router]);
  if(path==='/login') return <>{children}</>;
  if(!user.data) return <div className="loading">Connexion à votre espace JAMI FOOD…</div>;
  return <UserContext.Provider value={user.data}><div className="shell"><aside className="sidebar"><Link href="/" className="brand"><span>Jami</span><b>FOOD<span className="gold">●</span></b><small>LE GOÛT DU CAMPUS</small></Link><div className="nav-label">ESPACE DE GESTION</div><nav aria-label="Navigation principale">{links.filter(([, , , p])=>user.data.permissions.includes(p)).map(([href,label,Icon])=><Link className={path===href?'active':''} key={href} href={href}><Icon size={18}/>{label}</Link>)}</nav><div className="sidebar-bottom">Université Loyola du Congo<br/><small>Kinshasa · République démocratique du Congo</small></div></aside><div className="workspace"><header className="topbar"><span>JAMI FOOD <span className="muted">/ {links.find(([href])=>href===path)?.[1]}</span></span><div className="top-actions"><span className={online?'online':'offline'}>{online?'● Connecté':'● Hors connexion'}</span><span className="avatar">{user.data.firstName.slice(0,1)}</span><button className="icon-button" aria-label="Se déconnecter" onClick={async()=>{await api('/auth/logout',{});window.location.href='/login';}}><LogOut size={18}/></button></div></header><main><div className="preview">Environnement de démonstration · Tarifs et données de test · Recette en cours</div>{!online&&<div role="alert" className="error">Connexion indisponible. Les opérations nécessitent l’autorité commune du restaurant ; aucune validation de repas hors réseau n’est autorisée.</div>}{children}</main><footer>JAMI FOOD · Gestion du restaurant ULC <span>Heure de référence : Africa/Kinshasa</span></footer></div></div></UserContext.Provider>;
}
export function Shell({children}:{children:ReactNode}) {const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:10000,retry:1}}}));return <QueryClientProvider client={client}><Frame>{children}</Frame></QueryClientProvider>;}
