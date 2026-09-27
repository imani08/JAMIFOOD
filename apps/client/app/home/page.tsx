import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Clock3, MapPin, QrCode, Route, ShoppingBag, Sparkles, Utensils } from '../icons';

const categories = [
  { name: 'Repas', className: 'minimal-cat minimal-cat-meals', image:'/images/login-bowl.svg' },
  { name: 'Petit-déjeuner', className: 'minimal-cat minimal-cat-breakfast', image:'/images/category-breakfast.svg' },
  { name: 'Snacks', className: 'minimal-cat minimal-cat-snacks', image:'/images/register-food.svg' },
  { name: 'Boissons', className: 'minimal-cat minimal-cat-drinks', image:'/images/category-drinks.svg' },
];

export default function RestaurantHomePage() {
  return (
    <main className="modern-home">
      <section className="modern-hero">
        <div className="modern-hero-copy">
          <span className="modern-kicker"><Sparkles size={14}/> JAMI FOOD · ULC</span>
          <h1>Bien manger.<br/><em>Simplement.</em></h1>
          <p>Le menu du campus, votre panier et vos commandes dans une expérience claire, rapide et pensée pour les étudiants.</p>
          <div className="modern-hero-actions">
            <Link className="modern-primary" href="/menu">Voir le menu <ArrowRight size={17}/></Link>
            <Link className="modern-secondary" href="/account">Mon JAMI FOOD</Link>
          </div>
          <div className="modern-meta">
            <span><MapPin size={15}/> ULC · Kinshasa</span>
            <span><Clock3 size={15}/> Menu selon le service publié</span>
          </div>
        </div>
        <div className="modern-hero-visual" aria-hidden="true">
          <div className="modern-hero-image"/>
          <div className="modern-floating-card">
            <span className="modern-floating-icon"><Utensils size={18}/></span>
            <div><b>Votre pause, sans détour</b><small>Choisissez. Commandez. Profitez.</small></div>
          </div>
        </div>
      </section>

      <section className="modern-shortcuts" aria-label="Accès rapides">
        <Link href="/menu"><span><Utensils size={18}/></span><div><b>Menu</b><small>Voir les plats</small></div><ArrowRight size={15}/></Link>
        <Link href="/cart"><span><ShoppingBag size={18}/></span><div><b>Panier</b><small>Ma sélection</small></div><ArrowRight size={15}/></Link>
        <Link href="/track-order"><span><Route size={18}/></span><div><b>Suivre</b><small>Une commande</small></div><ArrowRight size={15}/></Link>
        <Link href="/account/qr"><span><QrCode size={18}/></span><div><b>Mon QR</b><small>Mon accès JAMI</small></div><ArrowRight size={15}/></Link>
      </section>

      <section className="modern-section">
        <div className="modern-section-head">
          <div><span>Explorer</span><h2>Nos catégories</h2></div>
          <Link href="/menu">Tout voir <ArrowRight size={15}/></Link>
        </div>
        <div className="minimal-category-grid">
          {categories.map(category => (
            <Link className={category.className} href={`/menu?category=${encodeURIComponent(category.name)}`} key={category.name} style={{backgroundImage:`linear-gradient(180deg,transparent 35%,rgba(10,10,10,.76)),url('${category.image}')`}}>
              <span className="minimal-cat-overlay"/>
              <b>{category.name}</b>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-discovery" aria-labelledby="discover-heading">
        <div className="home-discovery-art"><Image src="/images/category-breakfast.svg" alt="" width={220} height={180}/></div>
        <div><span className="modern-benefit-label">UNE PAUSE À VOTRE RYTHME</span><h2 id="discover-heading">Le menu du jour, simplement.</h2><p>Consultez les plats disponibles et leurs tarifs publiés par le restaurant.</p><Link className="modern-primary" href="/menu">Découvrir le menu <ArrowRight size={16}/></Link></div>
      </section>

      <section className="modern-benefit">
        <div>
          <span className="modern-benefit-label">MON JAMI FOOD</span>
          <h2>Tout ce dont vous avez besoin. Rien de plus.</h2>
          <p>Commandes, QR, droits repas, paiements et historique restent accessibles depuis votre espace personnel.</p>
          <Link className="modern-primary light" href="/account">Ouvrir mon espace <ArrowRight size={16}/></Link>
        </div>
        <div className="modern-benefit-grid">
          <article><ShoppingBag size={20}/><b>Commandes</b><small>Suivez vos commandes sans chercher.</small></article>
          <article><QrCode size={20}/><b>QR JAMI</b><small>Votre identifiant accessible rapidement.</small></article>
          <article><Utensils size={20}/><b>Droits repas</b><small>Consultez leur statut simplement.</small></article>
        </div>
      </section>
    </main>
  );
}
