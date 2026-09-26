'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Wallet, Users, Utensils, Package, ClipboardList, ShieldCheck, Settings, LogOut, CreditCard, CalendarDays, ScanLine, Menu, X } from 'lucide-react';
import { api } from '../lib/api';
import { hasPageAccess } from '../lib/route-access';
type User = { username: string; firstName: string; roles: string[]; permissions: string[] };
const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext);
const links = [
  ['/', 'Vue d’ensemble', LayoutDashboard, 'reports.read'], ['/pos', 'Caisse · TPE', CreditCard, 'sales.create'],
  ['/menus', 'Menus', CalendarDays, 'menus.read'], ['/products', 'Produits', Utensils, 'pricing.read'],
  ['/kitchen', 'Cuisine', Utensils, 'kitchen.read'], ['/delivery', 'Livraisons', Package, 'delivery.read'],
  ['/orders', 'Commandes', ClipboardList, 'orders.read'], ['/clients', 'Clients', Users, 'clients.read'],
  ['/subscriptions', 'Abonnements', CalendarDays, 'subscriptions.read'], ['/meals', 'Contrôle des repas', ScanLine, 'meal.validate'],
  ['/cash', 'Caisses & clôtures', Wallet, 'cash.read'], ['/expenses', 'Dépenses', Wallet, 'cash.expense'],
  ['/stock', 'Stocks & achats', Package, 'stock.read'], ['/reports', 'Rapports', LayoutDashboard, 'reports.read'],
  ['/audit', 'Journal d’audit', ShieldCheck, 'audit.read'], ['/users', 'Utilisateurs', Users, 'users.read'],
  ['/settings', 'Paramètres', Settings, 'pricing.read'],
] as const;
const navGroups = [
  ['Ventes', ['/pos', '/orders', '/kitchen', '/delivery']],
  ['Clients', ['/clients', '/subscriptions', '/meals']],
  ['Gestion', ['/products', '/menus', '/stock']],
  ['Finances', ['/cash', '/expenses', '/reports']],
  ['Administration', ['/users', '/settings', '/audit']],
] as const;
function Frame({ children }: { children: ReactNode }) {
  const path = usePathname(), router = useRouter();
  const user = useQuery({ queryKey: ['me'], queryFn: () => api<User>('/auth/me'), retry: false, enabled: path !== '/login' });
  const readiness = useQuery({ queryKey: ['api-ready'], queryFn: () => api('/health/ready'), retry: false, refetchInterval: 10000, networkMode: 'always' });
  const [online, setOnline] = useState(true);
  const [lastOnlineAt, setLastOnlineAt] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    const update = () => {
      const isOnline = navigator.onLine;
      setOnline(isOnline);
      if (isOnline) {
        const now = new Date().toISOString();
        localStorage.setItem('jami-last-online', now);
        setLastOnlineAt(now);
      } else setLastOnlineAt(localStorage.getItem('jami-last-online'));
    };
    setLastOnlineAt(localStorage.getItem('jami-last-online'));
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => { if (user.isError && path !== '/login') router.replace('/login'); }, [user.isError, path, router]);
  useEffect(() => setMobileNavOpen(false), [path]);
  if (path === '/login') return <>{children}</>;
  if (!user.data) return <div className="loading">Connexion à votre espace JAMI FOOD…</div>;

  const authorized = hasPageAccess(path, user.data.permissions);
  const availableLinks = links.filter(([, , , required]) => user.data!.permissions.includes(required));
  const title = links.find(([href]) => href === path)?.[1] ?? 'Espace de gestion';
  return <UserContext.Provider value={user.data}>
    <div className={`shell${mobileNavOpen ? ' nav-open' : ''}`}>
      <aside className="sidebar">
        <Link href="/" className="brand"><span>Jami</span><b>FOOD<span className="gold">●</span></b><small>LE GOÛT DU CAMPUS</small></Link>
        <div className="nav-label">ESPACE DE GESTION</div>
        <nav aria-label="Navigation principale">
          <Link aria-current={path === '/' ? 'page' : undefined} className={path === '/' ? 'active' : ''} href="/"><LayoutDashboard size={18}/>Vue d’ensemble</Link>
          {navGroups.map(([group, hrefs]) => {
            const groupLinks = availableLinks.filter(([href]) => (hrefs as readonly string[]).includes(href));
            return groupLinks.length ? <div className="nav-group" key={group}><div className="nav-label">{group}</div>{groupLinks.map(([href, label, Icon]) => <Link aria-current={path === href ? 'page' : undefined} className={path === href ? 'active' : ''} key={href} href={href}><Icon size={18}/>{label}</Link>)}</div> : null;
          })}
        </nav>
        <div className="sidebar-bottom">Université Loyola du Congo<br/><small>Kinshasa · République démocratique du Congo</small></div>
      </aside>
      <button className="nav-scrim" aria-label="Fermer la navigation" onClick={() => setMobileNavOpen(false)} />
      <div className="workspace">
        <header className="topbar">
          <button className="nav-toggle" aria-label={mobileNavOpen ? 'Fermer la navigation' : 'Ouvrir la navigation'} aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}>{mobileNavOpen ? <X size={20}/> : <Menu size={20}/>}</button>
          <span className="topbar-title">JAMI FOOD <span className="muted">/ {title}</span></span>
          <div className="top-actions"><span className={online && readiness.isSuccess ? 'online' : 'offline'}>{readiness.isSuccess ? '● Serveur accessible' : !online ? '● Réseau indisponible' : '● API / base indisponible'}</span><span className="user-meta"><strong>{user.data.firstName}</strong><small>{user.data.roles.map(role=>role.replaceAll('_',' ')).join(' · ')}</small></span><span className="avatar" aria-hidden="true">{user.data.firstName.slice(0, 1)}</span><button className="icon-button" aria-label="Se déconnecter" onClick={async () => { try { await api('/auth/logout', {}); } finally { window.location.href = '/login'; } }}><LogOut size={18}/><span className="logout-label">Déconnexion</span></button></div>
        </header>
        <main>
          <div className="preview">Environnement de démonstration · Tarifs et données de test · Recette en cours</div>
          {!online && <div role="alert" className="error"><strong>MODE HORS CONNEXION</strong><br/>L’autorité centrale JAMI FOOD est indisponible.<br/>Les validations de repas, paiements, modifications de tarifs et autres opérations sensibles sont suspendues.<br/>Utilisez uniquement la procédure de secours prévue par le restaurant.{lastOnlineAt && <><br/><small>Dernière connexion : {new Date(lastOnlineAt).toLocaleString('fr-FR', { timeZone: 'Africa/Kinshasa' })}</small></>}</div>}
          {online && readiness.isError && <p role="alert" className="error">Réseau détecté, mais API ou base de données inaccessible. Aucun paiement ou repas n’est validé localement. Vérifiez le serveur et le LAN ; une coupure Internet seule n’empêche pas un serveur local accessible de fonctionner.</p>}
          {authorized ? children : <section className="card access-denied" role="alert"><span className="badge">403 · Accès refusé</span><h1>Cette page n’est pas accessible avec votre rôle.</h1><p className="muted">Votre compte ne dispose pas de l’autorisation nécessaire. Aucune donnée de cette page n’a été chargée.</p><Link className="primary" href={availableLinks[0]?.[0] ?? '/login'}>Revenir à une page autorisée</Link></section>}
        </main>
        <footer>JAMI FOOD · Gestion du restaurant ULC <span>Heure de référence : Africa/Kinshasa</span></footer>
      </div>
    </div>
  </UserContext.Provider>;
}
export function Shell({ children }: { children: ReactNode }) { const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10000, retry: 1 } } })); return <QueryClientProvider client={client}><Frame>{children}</Frame></QueryClientProvider>; }
