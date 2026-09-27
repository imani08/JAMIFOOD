'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, KeyRound } from '../icons';
import { clientApi } from '../lib/api';

export default function EmailVerificationPendingPage(){
 const[email,setEmail]=useState('');const[devUrl,setDevUrl]=useState('');const[notice,setNotice]=useState('');const[busy,setBusy]=useState(false);const[emailSent,setEmailSent]=useState<boolean|null>(null);
 useEffect(()=>{setEmail(sessionStorage.getItem('jami-verification-email')??'');setDevUrl(sessionStorage.getItem('jami-verification-dev-url')??'');setEmailSent(sessionStorage.getItem('jami-verification-sent')==='true');},[]);
 async function resend(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setNotice('');try{const value=String(new FormData(event.currentTarget).get('email')??'');const response=await clientApi<{message:string;developmentUrl?:string}>('client/resend-verification',{method:'POST',body:{email:value}});setNotice(response.message);if(response.developmentUrl){setDevUrl(response.developmentUrl);sessionStorage.setItem('jami-verification-dev-url',response.developmentUrl);}}catch(e){setNotice(e instanceof Error?e.message:'Réessayez plus tard.');}finally{setBusy(false);}}
 return <main className="auth-layout"><Link href="/login" className="back-link"><ArrowLeft size={16}/> Retour à la connexion</Link><section className="auth-card"><span className="auth-symbol"><KeyRound/></span><span className="eyebrow">VÉRIFICATION DU COMPTE</span><h1>Vérifiez votre adresse e-mail</h1><p>{emailSent===true?'Un lien de vérification a été envoyé.':devUrl?'Mode développement : aucun e-mail n’a été envoyé. Utilisez le lien local ci-dessous.':emailSent===false?'Le fournisseur d’e-mail n’est pas configuré : aucun message n’a été envoyé. Configurez-le puis demandez un nouvel envoi.':'Un lien sera envoyé si votre compte doit être vérifié.'} Cette vérification reste distincte de la validation de votre identité ULC.</p>{devUrl&&<p><a className="text-link" href={devUrl}>Ouvrir le lien de vérification (mode développement)</a></p>}<form className="auth-form" onSubmit={resend}><label>Adresse e-mail<input name="email" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>{notice&&<p role="status">{notice}</p>}<button className="button button-dark full" disabled={busy}>{busy?'Envoi…':'Renvoyer l’e-mail'}</button></form><Link className="button button-dark full" href="/login">Retour à la connexion</Link></section></main>;
}
