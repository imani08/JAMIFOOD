'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ArrowLeft, ArrowRight, GraduationCap, Sparkles, UserRound } from '../icons';
import { clientApi } from '../lib/api';

type Kind = 'STUDENT_HOME'|'STUDENT_EXTERNAL'|'STAFF';

export default function RegisterPage() {
  const router = useRouter();
  const [kind,setKind]=useState<Kind|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!kind) return;
    setError('');
    setBusy(true);
    const data=new FormData(event.currentTarget);
    const value=(key:string)=>String(data.get(key)??'').trim();
    try {
      const result=await clientApi<{emailSent:boolean;developmentUrl?:string}>('client/register',{method:'POST',body:{type:kind,firstName:value('firstName'),lastName:value('lastName'),email:value('email'),password:value('password'),confirmPassword:value('confirmPassword'),ulcNumber:value('ulcNumber'),faculty:value('faculty'),promotion:value('promotion'),phone:value('phone')||undefined}});
      sessionStorage.setItem('jami-verification-email',value('email'));
      sessionStorage.setItem('jami-verification-sent',String(result.emailSent));
      if(result.developmentUrl)sessionStorage.setItem('jami-verification-dev-url',result.developmentUrl);
      router.push('/email-verification-pending');
      router.refresh();
    } catch(cause) {
      setError(cause instanceof Error?cause.message:'Inscription impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-stage register-stage">
      <section className="auth-media auth-media-register">
        <div className="auth-media-shade" />
        <Link href="/auth" className="auth-media-back"><ArrowLeft size={16}/> Retour</Link>
        <div className="auth-media-copy">
          <span className="eyebrow eyebrow-light"><Sparkles size={14}/> REJOIGNEZ JAMI FOOD</span>
          <h1>Votre campus, votre compte, votre expérience.</h1>
          <p>L’inscription est réservée aux étudiants et au personnel de l’Université Loyola du Congo.</p>
        </div>
      </section>

      <section className="auth-panel register-panel">
        <div className="auth-panel-inner register-panel-inner">
          <Link className="auth-mini-brand" href="/auth"><span className="wordmark-icon">J</span><span>JAMI <b>FOOD</b></span></Link>
          <span className="eyebrow">CRÉER MON COMPTE</span>
          <h2>Commençons par vous.</h2>
          <p className="auth-panel-lead">Choisissez votre profil ULC, puis complétez les informations nécessaires.</p><div className="auth-food-watermark alt" aria-hidden="true"/>

          <div className="choice-grid">
            <button type="button" className={kind==='STUDENT_HOME'||kind==='STUDENT_EXTERNAL'?'choice-card selected':'choice-card'} onClick={()=>setKind(kind?.startsWith('STUDENT')?kind:'STUDENT_HOME')}><GraduationCap/><span><b>Étudiant ULC</b><small>Résident au Home ou étudiant externe ULC</small></span></button>
            <button type="button" className={kind==='STAFF'?'choice-card selected':'choice-card'} onClick={()=>setKind('STAFF')}><UserRound/><span><b>Personnel ULC</b><small>Enseignant ou membre du personnel</small></span></button>
          </div>

          {kind && <form className="auth-form register-form" onSubmit={submit}>
            {kind!=='STAFF' && <div className="residency-choice"><span className="eyebrow">VOTRE SITUATION</span><div><button type="button" className={kind==='STUDENT_HOME'?'chip selected':'chip'} onClick={()=>setKind('STUDENT_HOME')}>Résident au Home</button><button type="button" className={kind==='STUDENT_EXTERNAL'?'chip selected':'chip'} onClick={()=>setKind('STUDENT_EXTERNAL')}>Étudiant externe</button></div></div>}
            <div className="register-two-columns"><label>Prénom<input name="firstName" autoComplete="given-name" required maxLength={80}/></label><label>Nom<input name="lastName" autoComplete="family-name" required maxLength={80}/></label></div>
            <label>E-mail<input name="email" type="email" autoComplete="email" placeholder="vous@exemple.com" required maxLength={254}/></label>
            <label>Identifiant ULC / matricule<input name="ulcNumber" required maxLength={50}/></label>
            {kind!=='STAFF' && <div className="register-two-columns"><label>Faculté<input name="faculty" required maxLength={120}/></label><label>Promotion<input name="promotion" required maxLength={80}/></label></div>}
            <label>Téléphone<input name="phone" type="tel" autoComplete="tel" maxLength={30}/></label>
            <div className="register-two-columns"><label>Mot de passe<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required/></label><label>Confirmer<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={256} required/></label></div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <p className="form-note">Votre compte est créé en attente de vérification ULC. Les avantages liés à votre catégorie restent protégés jusqu’à validation.</p>
            <button className="button button-dark full" type="submit" disabled={busy}>{busy?'Création…':<>Créer mon compte <ArrowRight size={16}/></>}</button>
          </form>}

          {!kind && <p className="register-prompt">Sélectionnez Étudiant ULC ou Personnel ULC pour poursuivre.</p>}
          <div className="auth-links"><span>Vous avez déjà un compte ? <Link href="/login">Se connecter</Link></span></div>
        </div>
      </section>
    </main>
  );
}
