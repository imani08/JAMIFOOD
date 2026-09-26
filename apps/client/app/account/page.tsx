import Link from 'next/link';
import { ArrowRight, BookOpenCheck, CreditCard, History, PackageCheck, QrCode, ReceiptText, UserRound } from '../icons';
import { PageIntro } from '../ui';

const areas = [
  { href: '/account/subscription', title: 'Mon abonnement', text: 'Formule, période et renouvellement', icon: BookOpenCheck },
  { href: '/account/rights', title: 'Mes droits', text: 'Vos droits repas et leur statut', icon: PackageCheck },
  { href: '/account/qr', title: 'Mon QR Code', text: 'Votre identifiant JAMI FOOD', icon: QrCode },
  { href: '/orders', title: 'Mes commandes', text: 'Suivre vos commandes', icon: PackageCheck },
  { href: '/account/payments', title: 'Mes paiements', text: 'Paiements liés à votre activité', icon: CreditCard },
  { href: '/account/receipts', title: 'Mes reçus', text: 'Retrouver vos justificatifs', icon: ReceiptText },
  { href: '/account/deliveries', title: 'Mes livraisons', text: 'Suivi de vos livraisons', icon: PackageCheck },
  { href: '/account/activity', title: 'Mon historique', text: 'Les moments de votre parcours', icon: History },
  { href: '/account/profile', title: 'Mon profil', text: 'Vos informations personnelles', icon: UserRound },
];

export default function AccountPage() { return <main className="page-wrap account-home"><PageIntro eyebrow="VOTRE ESPACE PERSONNEL" title="Mon JAMI FOOD" description="Tout votre parcours JAMI FOOD, rassemblé au même endroit."/><section className="account-welcome"><span className="account-orb">J</span><div><span className="eyebrow eyebrow-light">BIENVENUE DANS VOTRE ESPACE</span><h2>Bonjour et bienvenue 👋</h2><p>Connectez-vous pour afficher les informations de votre compte.</p></div><Link href="/login" className="button button-gold">Se connecter <ArrowRight size={16}/></Link></section><section className="account-grid" aria-label="Rubriques Mon JAMI FOOD">{areas.map(({href,title,text,icon:Icon})=><Link href={href} className="account-card" key={href}><span className="account-card-icon"><Icon size={20}/></span><span><b>{title}</b><small>{text}</small></span><ArrowRight className="account-card-arrow" size={17}/></Link>)}</section></main>; }
