import Link from 'next/link';
import { ArrowRight, Clock3, MapPin, ShoppingBag, Sparkles, Utensils } from '../icons';

const categories = [
  { name: 'Repas', className: 'home-cat-meals', text: 'Les plats du service publié aujourd’hui.' },
  { name: 'Petit-déjeuner', className: 'home-cat-breakfast', text: 'Commencez la journée avec une vraie pause.' },
  { name: 'Sandwichs & snacks', className: 'home-cat-snacks', text: 'Rapide, pratique et gourmand.' },
  { name: 'Boissons', className: 'home-cat-drinks', text: 'Pour compléter votre repas.' },
];

export default function RestaurantHomePage() {
  return (
    <main className="restaurant-home">
      <section className="restaurant-hero">
        <div className="restaurant-hero-photo" aria-hidden="true" />
        <div className="restaurant-hero-overlay" aria-hidden="true" />
        <div className="restaurant-hero-copy">
          <span className="eyebrow eyebrow-light"><Sparkles size={14}/> LE RESTAURANT DU CAMPUS</span>
          <h1>Qu’est-ce qui vous ferait <em>plaisir aujourd’hui ?</em></h1>
          <p>Découvrez le menu publié par JAMI FOOD, choisissez votre pause et retrouvez toute votre expérience dans un seul espace.</p>
          <div className="restaurant-hero-actions">
            <Link className="button button-gold" href="/menu">Voir le menu <ArrowRight size={17}/></Link>
            <Link className="restaurant-hero-secondary" href="/account">Mon JAMI FOOD</Link>
          </div>
          <div className="restaurant-hero-meta">
            <span><MapPin size={16}/> Université Loyola du Congo</span>
            <span><Clock3 size={16}/> Sur place · À emporter · Livraison selon disponibilité</span>
          </div>
        </div>
        <div className="restaurant-hero-badge"><span>FRAIS</span><b>JAMI</b><span>FOOD</span></div>
      </section>

      <section className="home-section home-categories">
        <div className="home-section-heading">
          <div><span className="eyebrow">EXPLOREZ SELON VOTRE ENVIE</span><h2>Des catégories claires, un choix simple.</h2></div>
          <Link className="text-link" href="/menu">Tout le menu <ArrowRight size={16}/></Link>
        </div>
        <div className="home-category-grid">
          {categories.map(category => (
            <Link href="/menu" className={"home-category-card " + category.className} key={category.name}>
              <span className="home-category-shade" />
              <span className="home-category-content"><b>{category.name}</b><small>{category.text}</small><i>Découvrir <ArrowRight size={14}/></i></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-feature-band">
        <div className="home-feature-copy">
          <span className="eyebrow eyebrow-light">MON JAMI FOOD</span>
          <h2>Votre activité, sans chercher partout.</h2>
          <p>Depuis votre compte, retrouvez vos commandes, votre abonnement s’il existe, vos droits repas, votre QR Code, vos paiements et vos reçus.</p>
          <Link className="button button-gold" href="/account">Ouvrir mon espace <ArrowRight size={17}/></Link>
        </div>
        <div className="home-feature-cards">
          <article><span><ShoppingBag size={21}/></span><b>Mes commandes</b><small>Suivez leur progression en un coup d’œil.</small></article>
          <article><span><Utensils size={21}/></span><b>Mes droits repas</b><small>Disponible, réservé ou consommé : tout reste clair.</small></article>
          <article><span className="home-qr-symbol">▦</span><b>Mon QR</b><small>Présentez rapidement votre identifiant JAMI FOOD.</small></article>
        </div>
      </section>

      <section className="home-story">
        <div className="home-story-image" aria-hidden="true" />
        <div className="home-story-copy">
          <span className="eyebrow">UN MOMENT À PART SUR LE CAMPUS</span>
          <h2>Plus qu’un repas, une vraie pause.</h2>
          <p>JAMI FOOD rassemble le menu, le service et votre parcours client dans une expérience pensée d’abord pour le téléphone.</p>
          <div className="home-story-points"><span>01 <b>Choisissez</b></span><span>02 <b>Commandez</b></span><span>03 <b>Profitez</b></span></div>
        </div>
      </section>
    </main>
  );
}
