'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, LockKeyhole, Sparkles } from '../icons';
import { clientApi } from '../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await clientApi('client/login', { method: 'POST', body: { email: data.get('email'), password: data.get('password') } });
      router.push('/home');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connexion impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-stage">
      <section className="auth-media auth-media-login">
        <div className="auth-media-shade" />
        <Link href="/auth" className="auth-media-back"><ArrowLeft size={16}/> Retour</Link>
        <div className="auth-media-copy">
          <span className="eyebrow eyebrow-light"><Sparkles size={14}/> BON RETOUR</span>
          <h1>Votre table digitale vous attend.</h1>
          <p>Commandes, QR, droits repas et reçus : retrouvez votre JAMI FOOD dès la connexion.</p>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-inner">
          <Link className="auth-mini-brand" href="/auth"><span className="wordmark-icon">J</span><span>JAMI <b>FOOD</b></span></Link>
          <span className="auth-symbol"><LockKeyhole/></span>
          <span className="eyebrow">VOTRE ESPACE PERSONNEL</span>
          <h2>Ravi de vous retrouver.</h2>
          <p className="auth-panel-lead">Connectez-vous pour continuer votre expérience JAMI FOOD.</p>
          <form className="auth-form" onSubmit={submit}>
            <label>Adresse e-mail<input name="email" autoComplete="username" type="email" placeholder="vous@exemple.com" required maxLength={254}/></label>
            <label>Mot de passe<input name="password" autoComplete="current-password" type="password" placeholder="Votre mot de passe" required maxLength={256}/></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-dark full" type="submit" disabled={busy}>{busy ? 'Connexion…' : <>Se connecter <ArrowRight size={16}/></>}</button>
          </form>
          <div className="auth-links"><Link href="/forgot-password">Mot de passe oublié ?</Link><span>Pas encore de compte ? <Link href="/register">Créer un compte ULC</Link></span></div>
          <Link className="auth-guest-link" href="/home">Continuer en visiteur</Link>
        </div>
      </section>
    </main>
  );
}
