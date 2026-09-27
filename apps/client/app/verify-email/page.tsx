'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, KeyRound } from '../icons';
import { clientApi } from '../lib/api';

export default function VerifyEmailPage(){
 const router=useRouter();const started=useRef(false);
 const[state,setState]=useState<'loading'|'success'|'error'>('loading');const[message,setMessage]=useState('Vérification du lien…');
 useEffect(()=>{if(started.current)return;started.current=true;const token=new URLSearchParams(window.location.search).get('token');router.replace('/verify-email',{scroll:false});if(!token){setState('error');setMessage('Lien manquant ou invalide.');return;}clientApi('client/verify-email',{method:'POST',body:{token}}).then(()=>{sessionStorage.removeItem('jami-verification-dev-url');router.replace('/account/qr');}).catch(e=>{setState('error');setMessage(e instanceof Error?e.message:'Lien invalide ou expiré.');});},[router]);
 return <main className="auth-layout"><Link href="/login" className="back-link"><ArrowLeft size={16}/> Retour à la connexion</Link><section className="auth-card"><span className="auth-symbol"><KeyRound/></span><span className="eyebrow">VÉRIFICATION DU COMPTE</span><h1>{state==='success'?'Adresse confirmée':'Vérifiez votre adresse e-mail'}</h1><p role="status">{message}</p>{state==='success'?<Link className="button button-dark full" href="/login">Continuer vers JAMI FOOD</Link>:state==='error'?<Link className="button button-dark full" href="/email-verification-pending">Renvoyer l’e-mail</Link>:null}</section></main>;
}
