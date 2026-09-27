'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronDown, CircleUserRound, ClipboardList, Home, Menu as MenuIcon, QrCode, Route, ShoppingBag, Utensils, X } from './icons';

const links = [{ href: '/', label: 'Accueil', icon: Home }, { href: '/menu', label: 'Menu', icon: Utensils }, { href: '/cart', label: 'Panier', icon: ShoppingBag }, { href: '/orders', label: 'Commandes', icon: ClipboardList }, { href: '/account/qr', label: 'Mon QR', icon: QrCode }];

export function ClientShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [guest, setGuest] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => { let active=true; fetch('/api/v1/client/me',{credentials:'include'}).then(response=>{if(active)setGuest(!response.ok);}).catch(()=>{if(active)setGuest(true);}); return()=>{active=false;}; }, [path]);
  const visibleLinks = guest ? [...links.slice(0, 3), { href: '/track-order', label: 'Suivre', icon: Route }, { href: '/login', label: 'Connexion', icon: CircleUserRound }] : links;
  return <>
    {path !== '/welcome' && <header className="site-header"><Link className="wordmark" href="/" aria-label="JAMI FOOD accueil"><span className="wordmark-icon">J</span><span>JAMI <b>FOOD</b><small>LE GOÛT DU CAMPUS</small></span></Link>
      <nav className="desktop-nav" aria-label="Navigation principale">{visibleLinks.slice(0, 4).map(({ href, label }) => <Link key={href} href={href} className={path === href ? 'nav-link active' : 'nav-link'}>{label}</Link>)}</nav>
      <div className="header-actions">{guest ? <><Link className="login-link" href="/login">Se connecter</Link><Link className="button button-dark header-cta" href="/register">Créer un compte <ArrowRight size={15} /></Link></> : <Link href="/account" className="account-pill"><CircleUserRound size={19} /> Mon JAMI FOOD <ChevronDown size={14} /></Link>}<button className="mobile-menu-button" onClick={() => setOpen(!open)} aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}>{open ? <X /> : <MenuIcon />}</button></div>
    </header>}
    {open && <nav className="mobile-drawer">{visibleLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)}><Icon size={18} />{label}</Link>)}<Link href="/login" onClick={() => setOpen(false)}>Se connecter</Link></nav>}
    {children}
    {path !== '/welcome' && <><nav className="bottom-nav" aria-label="Navigation mobile">{visibleLinks.slice(0, 5).map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={path === href ? 'bottom-link active' : 'bottom-link'}><Icon size={19} strokeWidth={path === href ? 2.4 : 1.7} /><span>{label}</span></Link>)}</nav><footer className="site-footer"><Link className="wordmark footer-mark" href="/"><span className="wordmark-icon">J</span><span>JAMI <b>FOOD</b><small>UNIVERSITÉ LOYOLA DU CONGO</small></span></Link><span>Bien manger, vivre le campus.</span><span>© {new Date().getFullYear()} JAMI FOOD</span></footer></>}
  </>;
}

export function PageIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="page-intro"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>; }
const emptyIcons = { Utensils, QrCode } as const;
export function EmptyCard({ iconName = 'Utensils', title, text, action }: { iconName?: keyof typeof emptyIcons; title: string; text: string; action?: React.ReactNode }) { const Icon = emptyIcons[iconName]; return <section className="empty-card"><span className="empty-icon"><Icon size={24} /></span><h2>{title}</h2><p>{text}</p>{action}</section>; }
export function ComingSoon({ title, detail }: { title: string; detail: string }) { return <main className="page-wrap"><PageIntro eyebrow="MON JAMI FOOD" title={title} description={detail} /><EmptyCard iconName="QrCode" title="Votre espace personnel" text="Connectez-vous pour retrouver ici les informations qui vous appartiennent. La confidentialité de votre compte est notre priorité." action={<Link className="button button-dark" href="/login">Se connecter <ArrowRight size={16} /></Link>} /></main>; }
