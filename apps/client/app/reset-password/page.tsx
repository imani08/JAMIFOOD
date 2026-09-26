import Link from 'next/link';
import { ArrowLeft, KeyRound } from '../icons';

export default function ResetPasswordPage() { return <main className="auth-layout"><Link href="/login" className="back-link"><ArrowLeft size={16}/> Retour à la connexion</Link><section className="auth-card"><span className="auth-symbol"><KeyRound/></span><span className="eyebrow">SÉCURITÉ DU COMPTE</span><h1>Réinitialiser le mot de passe</h1><p>Ouvrez le lien sécurisé envoyé par JAMI FOOD pour continuer.</p><Link className="button button-dark full" href="/login">Retour à la connexion</Link></section></main>; }
