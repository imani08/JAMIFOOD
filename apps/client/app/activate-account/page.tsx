'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, KeyRound } from '../icons';
import { clientApi } from '../lib/api';

export default function ActivateAccountPage(){
  const router=useRouter();
  const [token,setToken]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{setToken(new URLSearchParams(window.location.search).get('token')??'');router.replace('/activate-account',{scroll:false});},[router]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setError('');setBusy(true);const data=new FormData(event.currentTarget);
    try{await clientApi('client/accept-invitation',{method:'POST',body:{token,password:data.get('password'),confirmPassword:data.get('confirmPassword')}});router.replace('/account/qr');}
    catch(e){setError(e instanceof Error?e.message:'Invitation invalide ou expirée.');setBusy(false);}
  }
  return <main className="auth-layout"><Link href="/login" className="back-link"><ArrowLeft size={16}/> Retour à la connexion</Link><section className="auth-card"><span className="auth-symbol"><KeyRound/></span><span className="eyebrow">BIENVENUE CHEZ JAMI FOOD</span><h1>Activez votre compte</h1><form className="auth-form" onSubmit={submit}><p>Choisissez un mot de passe d’au moins 12 caractères pour accéder à votre espace client.</p><label>Nouveau mot de passe<input name="password" type="password" minLength={12} maxLength={256} required autoComplete="new-password"/></label><label>Confirmer le mot de passe<input name="confirmPassword" type="password" minLength={12} maxLength={256} required autoComplete="new-password"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button button-dark full" disabled={busy||!token}>{busy?'Activation…':'Activer mon compte'}</button>{!token&&<p role="alert">Lien d’activation manquant. Demandez une nouvelle invitation à JAMI FOOD.</p>}</form></section></main>;
}
