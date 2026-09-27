'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ArrowLeft, KeyRound } from '../icons';
import { clientApi } from '../lib/api';

export default function ForgotPasswordPage() {
  const [sent,setSent]=useState(false); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');setBusy(true);try{await clientApi('client/forgot-password',{method:'POST',body:{email:new FormData(event.currentTarget).get('email')}});setSent(true);}catch(e){setError(e instanceof Error?e.message:'Demande impossible.');}finally{setBusy(false);}}
  return <main className="auth-layout"><Link href="/login" className="back-link"><ArrowLeft size={16}/> Retour à la connexion</Link><section className="auth-card"><span className="auth-symbol"><KeyRound/></span><span className="eyebrow">RÉCUPÉRATION DU COMPTE</span><h1>Mot de passe oublié ?</h1>{sent?<p>Si un compte correspond à cette adresse, un lien de récupération a été envoyé.</p>:<><p>Indiquez l’adresse e-mail de votre compte. Si elle est reconnue, vous recevrez un lien temporaire.</p><form className="auth-form" onSubmit={submit}><label>Adresse e-mail<input name="email" type="email" autoComplete="email" required maxLength={254}/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button button-dark full" disabled={busy}>{busy?'Envoi…':'Envoyer le lien'}</button></form></>}<Link className="button button-dark full" href="/login">Retour à la connexion</Link></section></main>;
}
