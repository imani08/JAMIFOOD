import './globals.css';
import Link from 'next/link';
import { ReactNode } from 'react';
export const metadata = { title: 'JAMI FOOD', description: 'Gestion intégrée du restaurant ULC', manifest: '/manifest.webmanifest' };
const links = [['/', 'Tableau de bord'], ['/pos', 'Caisse POS'], ['/kitchen', 'Cuisine'], ['/clients', 'Clients'], ['/orders', 'Commandes'], ['/cash', 'Caisse'], ['/reports', 'Rapports'], ['/settings', 'Paramètres']];
export default function Layout({ children }: { children: ReactNode }) { return <html lang="fr"><body><div className="shell"><aside className="sidebar"><div className="brand">JAMI FOOD<br/><small>Université Loyola du Congo</small></div><nav className="nav">{links.map(([href,label]) => <Link key={href} href={href}>{label}</Link>)}</nav></aside><main>{children}</main></div></body></html>; }
