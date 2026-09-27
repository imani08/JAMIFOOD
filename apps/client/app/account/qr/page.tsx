'use client';

import { useCallback,useEffect,useState } from 'react';
import QRCode from 'qrcode';
import Link from 'next/link';
import { ApiError,clientApi } from '../../lib/api';
import { PageIntro } from '../../ui';
type Code={id:string;token:string;issuedAt:string};
export default function QrPage(){
 const [code,setCode]=useState<Code|null>(null);const [image,setImage]=useState('');const [error,setError]=useState('');const [loading,setLoading]=useState(true);const [kind,setKind]=useState<'login'|'verify'|'retry'>('retry');
 const load=useCallback(async()=>{setLoading(true);setError('');setCode(null);setImage('');try{const value=await clientApi<Code>('client/qr');const rendered=await QRCode.toDataURL(value.token,{width:280,margin:2,errorCorrectionLevel:'Q',color:{dark:'#421324',light:'#ffffff'}});setCode(value);setImage(rendered);}catch(e){setError(e instanceof Error?e.message:'QR Code indisponible.');setKind(e instanceof ApiError&&e.status===401?'login':e instanceof ApiError&&e.code==='EMAIL_VERIFICATION_REQUIRED'?'verify':'retry');}finally{setLoading(false);}},[]);
 useEffect(()=>{void load();},[load]);
 return <main className="page-wrap"><PageIntro eyebrow="MON JAMI FOOD" title="Mon QR Code" description="Votre identifiant opaque pour faire vérifier vos droits par le personnel JAMI FOOD."/>{loading?<p role="status">Chargement de votre QR Code…</p>:error?<section className="empty-card"><h2>{kind==='login'?'Connexion nécessaire':kind==='verify'?'Vérifiez votre adresse e-mail':'QR Code indisponible'}</h2><p>{error}</p>{kind==='login'?<Link className="button button-dark" href="/login">Se connecter</Link>:kind==='verify'?<Link className="button button-dark" href="/email-verification-pending">Vérifier mon e-mail</Link>:<button type="button" className="button button-dark" onClick={()=>void load()}>Réessayer</button>}</section>:code&&<section className="qr-card"><img src={image} alt="QR Code personnel JAMI FOOD" width="280" height="280"/><small>Code manuel complet à saisir si le scanner ne fonctionne pas</small><code style={{display:'block',margin:'8px 0 12px',fontSize:13,overflowWrap:'anywhere',userSelect:'all'}}>{code.token}</code><small>Présentez ce QR Code ou son code manuel au personnel JAMI FOOD pour vérifier vos droits.</small></section>}</main>
}
