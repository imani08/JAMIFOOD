import type { Metadata, Viewport } from 'next';
import './styles.css';
import { ClientShell } from './ui';

export const metadata: Metadata = { title: { default: 'JAMI FOOD · Le goût du campus', template: '%s · JAMI FOOD' }, description: 'Le restaurant du campus ULC, simplement.', applicationName: 'JAMI FOOD' };
export const viewport: Viewport = { themeColor: '#7b1028', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body><ClientShell>{children}</ClientShell></body></html>;
}
