import Link from 'next/link';
import { ArrowRight, Sparkles, Utensils, UserRound } from '../icons';

export default function AuthEntryPage() {
  return (
    <main className="auth-entry">
      <section className="auth-entry-visual" aria-label="Ambiance JAMI FOOD">
        <div className="auth-entry-overlay" />
        <div className="auth-entry-brand">
          <span className="eyebrow eyebrow-light"><Sparkles size={14}/> JAMI FOOD · ULC</span>
          <h1>Votre pause.<br/><em>Votre goût.</em></h1>
          <p>Des repas qui donnent envie, une expérience simple et tout votre JAMI FOOD au même endroit.</p>
          <div className="auth-entry-proof">
            <span><Utensils size={17}/> Menu du jour</span>
            <span><UserRound size={17}/> Espace personnel</span>
          </div>
        </div>
        <p className="auth-photo-caption">Bien manger, vivre le campus.</p>
      </section>

      <section className="auth-entry-panel">
        <div className="auth-entry-panel-inner">
          <Link className="auth-mini-brand" href="/auth" aria-label="JAMI FOOD">
            <span className="wordmark-icon">J</span>
            <span>JAMI <b>FOOD</b></span>
          </Link>
          <span className="eyebrow">BIENVENUE CHEZ JAMI FOOD</span>
          <h2>Comment souhaitez-vous entrer ?</h2>
          <p className="auth-entry-lead">Connectez-vous à votre espace, créez votre compte ULC ou découvrez le restaurant en visiteur.</p>

          <div className="auth-choice-stack">
            <Link className="auth-choice primary" href="/login">
              <span className="auth-choice-number">01</span>
              <span><b>Se connecter</b><small>Retrouver mes commandes, droits et activités.</small></span>
              <ArrowRight size={18}/>
            </Link>
            <Link className="auth-choice" href="/register">
              <span className="auth-choice-number">02</span>
              <span><b>Créer mon compte</b><small>Pour les étudiants et le personnel de l’ULC.</small></span>
              <ArrowRight size={18}/>
            </Link>
            <Link className="auth-choice guest" href="/home">
              <span className="auth-choice-number">03</span>
              <span><b>Continuer comme visiteur</b><small>Découvrir le menu et l’univers JAMI FOOD.</small></span>
              <ArrowRight size={18}/>
            </Link>
          </div>

          <p className="auth-entry-note">Les visiteurs externes peuvent parcourir le restaurant sans créer de compte. L’inscription est réservée à la communauté ULC.</p>
        </div>
      </section>
    </main>
  );
}
