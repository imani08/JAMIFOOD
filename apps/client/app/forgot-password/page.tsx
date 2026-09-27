import Link from 'next/link';
import { ArrowLeft, KeyRound } from '../icons';

export default function ForgotPasswordPage() { return <main className="auth-layout"><Link href="/login" className="back-link"><ArrowLeft size={16}/> Retour à la connexion</Link><section className="auth-card"><span className="auth-symbol"><KeyRound/></span><span className="eyebrow">RÉCUPÉRATION DU COMPTE</span><h1>Besoin d’aide ?</h1><p>Pour protéger votre compte, contactez le service client ULC afin de vérifier votre identité. Aucun lien de réinitialisation n’est envoyé tant qu’une adresse e-mail vérifiée n’est pas configurée.</p><Link className="button button-dark full" href="/login">Retour à la connexion</Link></section></main>; }
