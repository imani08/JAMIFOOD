import Link from 'next/link';
import { ArrowLeft, KeyRound } from '../icons';

export default function ForgotPasswordPage() { return <main className="auth-layout"><Link href="/login" className="back-link"><ArrowLeft size={16}/> Retour à la connexion</Link><section className="auth-card"><span className="auth-symbol"><KeyRound/></span><span className="eyebrow">RÉCUPÉRATION DU COMPTE</span><h1>Besoin d’aide ?</h1><p>La récupération sécurisée sera disponible avec l’activation de l’authentification client.</p><Link className="button button-dark full" href="/login">Retour à la connexion</Link></section></main>; }
