import './globals.css';
import { ReactNode } from 'react';
import { Shell } from '../components/shell';
export const metadata = { title: 'JAMI FOOD · Gestion du restaurant', description: 'Restaurant de l’Université Loyola du Congo', manifest: '/manifest.webmanifest' };
export default function Layout({children}:{children:ReactNode}) {return <html lang="fr"><body><Shell>{children}</Shell></body></html>;}
