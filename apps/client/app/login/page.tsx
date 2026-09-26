'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ArrowLeft, LockKeyhole } from '../icons';
import { clientApi } from '../lib/api';

export default function LoginPage() {
  const router = useRouter(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const data = new FormData(event.currentTarget);
    try { await clientApi('client/login', { method: 'POST', body: { email: data.get('email'), password: data.get('password') } }); router.push('/account'); router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Connexion impossible.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-layout"><Link href="/" className="back-link"><ArrowLeft size={16}/> Retour à l’accueil</Link><section className="auth-card"><span className="auth-symbol"><LockKeyhole/></span><span className="eyebrow">VOTRE ESPACE PERSONNEL</span><h1>Ravi de vous retrouver.</h1><p>Connectez-vous à votre compte JAMI FOOD.</p><form className="auth-form" onSubmit={submit}><label>Adresse e-mail<input name="email" autoComplete="username" type="email" placeholder="nom@ulc.cd" required maxLength={254}/></label><label>Mot de passe<input name="password" autoComplete="current-password" type="password" placeholder="Votre mot de passe" required maxLength={256}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button button-dark full" type="submit" disabled={busy}>{busy?'Connexion…':'Se connecter'}</button></form><p className="form-note">Les comptes clients sont séparés des comptes du personnel.</p><div className="auth-links"><Link href="/forgot-password">Mot de passe oublié ?</Link><span>Pas encore de compte ? <Link href="/register">Créer un compte ULC</Link></span></div></section></main>;
}
