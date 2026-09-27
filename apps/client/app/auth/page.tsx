import Link from 'next/link';
import { ArrowRight, Sparkles } from '../icons';

export default function AuthEntryPage() {
  return (
    <main className="minimal-auth">
      <section className="minimal-auth-visual">
        <div className="minimal-auth-image" aria-hidden="true"/>
        <div className="minimal-auth-overlay"/>
        <div className="minimal-auth-brand">
          <span className="modern-kicker light"><Sparkles size={14}/> JAMI FOOD · ULC</span>
          <h1>Votre pause.<br/>Votre JAMI.</h1>
          <p>Une expérience simple, moderne et pensée pour le rythme du campus.</p>
        </div>
      </section>

      <section className="minimal-auth-panel">
        <div className="minimal-auth-inner">
          <Link className="minimal-logo" href="/auth">
            <span>J</span><b>JAMI FOOD</b>
          </Link>

          <div className="minimal-auth-heading">
            <span>Bienvenue</span>
            <h2>On commence comment ?</h2>
            <p>Accédez à votre compte ULC ou découvrez simplement le menu.</p>
          </div>

          <div className="minimal-auth-actions">
            <Link className="minimal-auth-action primary" href="/login">
              <div><b>Se connecter</b><small>Mon espace, mes commandes et mon QR</small></div>
              <ArrowRight size={18}/>
            </Link>
            <Link className="minimal-auth-action" href="/register">
              <div><b>Créer mon compte</b><small>Étudiant ou personnel ULC</small></div>
              <ArrowRight size={18}/>
            </Link>
            <Link className="minimal-auth-action ghost" href="/home">
              <div><b>Continuer comme visiteur</b><small>Voir le menu sans créer de compte</small></div>
              <ArrowRight size={18}/>
            </Link>
          </div>

          <p className="minimal-auth-note">L’inscription est réservée aux étudiants et au personnel ULC.</p>
          <p className="developer-credit auth-credit">Développé par <a href="https://www.linkedin.com/in/imani-k-844107274/" target="_blank" rel="noreferrer">Imani Kalumuna</a></p>
        </div>
      </section>
    </main>
  );
}
