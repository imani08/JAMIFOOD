'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { clientApi } from './lib/api';

export default function StartupPage() {
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const minimumSplash = new Promise(resolve => window.setTimeout(resolve, 1050));
    const session = clientApi('client/me').then(() => true).catch(() => false);

    Promise.all([minimumSplash, session]).then(([, authenticated]) => {
      if (!active) return;
      router.replace(authenticated ? '/home' : '/auth');
    });

    return () => { active = false; };
  }, [router]);

  return (
    <main className="startup-splash" aria-label="Chargement de JAMI FOOD">
      <div className="startup-photo" aria-hidden="true" />
      <div className="startup-shade" aria-hidden="true" />
      <div className="startup-grain" aria-hidden="true" />
      <div className="startup-content">
        <div className="startup-logo">J<span>F</span></div>
        <p className="startup-brand">JAMI <b>FOOD</b></p>
        <p className="startup-tagline">LE GOÛT DU CAMPUS</p>
        <div className="startup-loader" aria-hidden="true"><i /></div>
      </div>
      <div className="startup-caption">
        <span>Université Loyola du Congo</span>
        <span>Restaurant étudiant · Kinshasa</span>
      </div>
    </main>
  );
}
