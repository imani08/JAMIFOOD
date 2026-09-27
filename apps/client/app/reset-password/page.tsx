'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, KeyRound } from '../icons';
import { clientApi } from '../lib/api';

export default function ResetPasswordPage() {
  const router=useRouter();
  const [token,setToken]=useState('');const [done,setDone]=useState(false);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{setToken(new URLSearchParams(window.location.search).get('token')??'');router.replace('/reset-password',{scroll:false});},[router]);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setError('');setBusy(true);const data=new FormData(event.currentTarget);try{await clientApi('client/reset-password',{method:'POST',body:{token,password:data.get('password'),confirmPassword:data.get('confirmPassword')}});setDone(true);}catch(e){setError(e instanceof Error?e.message:'Lien invalide ou expiré.');}finally{setBusy(false);}}
  return <main className="auth-layout"><Link href="/login" className="back-link"><ArrowLeft size={16}/> Retour à la connexion</Link><section className="auth-card"><span className="auth-symbol"><KeyRound/></span><span className="eyebrow">SÉCURITÉ DU COMPTE</span><h1>Réinitialiser le mot de passe</h1>{done?<><p>Mot de passe modifié. Vous pouvez vous connecter avec votre nouveau mot de passe.</p><Link className="button button-dark full" href="/login">Se connecter</Link></>:<form className="auth-form" onSubmit={submit}><p>Choisissez un mot de passe d’au moins 12 caractères. Le lien expire après 20 minutes.</p><label>Nouveau mot de passe<input name="password" type="password" minLength={12} maxLength={256} required autoComplete="new-password"/></label><label>Confirmer le mot de passe<input name="confirmPassword" type="password" minLength={12} maxLength={256} required autoComplete="new-password"/></label>{error&&<p className="form-error" role="alert">{error}</p>}<button className="button button-dark full" disabled={busy||!token}>{busy?'Modification…':'Enregistrer le nouveau mot de passe'}</button>{!token&&<p role="alert">Lien manquant ou invalide.</p>}</form>}</section></main>;
}
