'use client';

import { useEffect,useState } from 'react';
import QRCode from 'qrcode';
import Link from 'next/link';
import { clientApi } from '../../lib/api';
import { PageIntro,EmptyCard } from '../../ui';
type Code={id:string;token:string;issuedAt:string};
export default function QrPage(){const [code,setCode]=useState<Code|null>(null);const [image,setImage]=useState('');const [error,setError]=useState('');useEffect(()=>{clientApi<Code>('client/qr').then(async value=>{setCode(value);setImage(await QRCode.toDataURL(value.token,{width:280,margin:2,errorCorrectionLevel:'Q',color:{dark:'#421324',light:'#ffffff'}}));}).catch(e=>setError(e.message));},[]);return <main className="page-wrap"><PageIntro eyebrow="MON JAMI FOOD" title="Mon QR Code" description="Votre identifiant opaque pour faire vérifier vos droits par le personnel JAMI FOOD."/>{error?<EmptyCard iconName="QrCode" title="QR Code indisponible" text={error} action={<Link className="button button-dark" href="/login">Se connecter</Link>}/>:code?<section className="qr-card"><img src={image} alt="QR Code personnel JAMI FOOD" width="280" height="280"/><b>{code.id.slice(0,8).toUpperCase()}</b><small>Présentez ce code au personnel JAMI FOOD. Il ne contient aucune donnée personnelle.</small></section>:<p role="status">Chargement du QR Code…</p>}</main>}
