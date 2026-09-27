'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

type TourStep = { path: string; title: string; text: string; controls: string };
type Props = { mode: 'loading' | 'guest' | 'client' };

const publicSteps: TourStep[] = [
  { path: '/auth', title: 'Bienvenue chez JAMI FOOD', text: 'Cette page est la porte d’entrée du restaurant.', controls: '« Se connecter » ouvre votre session; « Créer un compte » démarre l’inscription; « Continuer en visiteur » permet de découvrir le menu sans compte.' },
  { path: '/home', title: 'Accueil', text: 'La page d’accueil présente les services disponibles et les informations du restaurant.', controls: 'Le logo et « Accueil » reviennent ici; « Voir le menu » ouvre les plats; les formules affichent les offres publiées; les raccourcis mènent au menu, au panier ou au QR selon votre accès.' },
  { path: '/menu', title: 'Le menu', text: 'Consultez les plats réellement publiés, leur prix et leur disponibilité.', controls: 'La recherche filtre les plats; les boutons de catégorie affinent la liste; « Ajouter » place un plat dans le panier. « Voir mon panier » ouvre votre sélection.' },
  { path: '/cart', title: 'Votre panier', text: 'Vérifiez votre sélection avant de la soumettre.', controls: '− et + changent les quantités; « Service » choisit sur place ou à emporter; « Valider la commande » l’envoie si vous êtes connecté. Le total est indicatif jusqu’à validation serveur.' },
  { path: '/track-order', title: 'Suivi de commande', text: 'Consultez l’état d’une commande à partir des informations demandées sur la page.', controls: 'Saisissez la référence et les informations indiquées, puis utilisez le bouton de recherche pour afficher le suivi.' },
  { path: '/register', title: 'Créer un compte', text: 'Le formulaire crée votre accès personnel JAMI FOOD.', controls: 'Renseignez les champs obligatoires, vérifiez l’adresse e-mail et les informations ULC, puis utilisez « Créer mon compte ». Les liens en bas permettent de se connecter ou de vérifier l’e-mail.' },
  { path: '/login', title: 'Se connecter', text: 'Retrouvez votre compte avec vos identifiants.', controls: 'Entrez votre e-mail et votre mot de passe puis choisissez « Se connecter ». « Mot de passe oublié » lance la récupération; après connexion, relancez le guide pour parcourir votre compte.' },
];

const accountSteps: TourStep[] = [
  { path: '/account', title: 'Mon espace JAMI FOOD', text: 'Le tableau de bord rassemble les raccourcis et les informations de votre compte.', controls: 'Les cartes ouvrent abonnements, droits, QR, commandes, paiements, reçus, livraisons et historique. « Se déconnecter » ferme votre session.' },
  { path: '/account/subscription', title: 'Mon abonnement', text: 'Consultez les détails et l’état de votre abonnement.', controls: 'Les cartes présentent la formule, sa période et son état lorsqu’ils sont fournis par le serveur. La navigation permet de revenir au tableau de bord.' },
  { path: '/account/rights', title: 'Mes droits', text: 'Retrouvez les droits associés à votre compte et à votre catégorie.', controls: 'Les lignes détaillent les droits disponibles et leur état; aucun avantage n’est simulé.' },
  { path: '/account/qr', title: 'Mon QR Code', text: 'Présentez votre QR Code personnel au personnel JAMI FOOD.', controls: 'Le QR et son code manuel sont deux moyens d’identification. « Réessayer » recharge le code en cas d’erreur; les liens de connexion ou de vérification s’affichent si nécessaire.' },
  { path: '/orders', title: 'Mes commandes', text: 'Consultez vos commandes et ouvrez leur suivi.', controls: 'Chaque commande ouvre sa fiche détaillée; vous y retrouvez le statut, les articles, les montants et l’historique.' },
  { path: '/account/payments', title: 'Mes paiements', text: 'Retrouvez les paiements rattachés à votre compte.', controls: 'Ouvrez un élément pour consulter son détail lorsqu’il est disponible; l’écran vide indique qu’aucun paiement n’est enregistré.' },
  { path: '/account/receipts', title: 'Mes reçus', text: 'Accédez aux reçus disponibles.', controls: 'Les reçus listés correspondent aux données du compte; ouvrez un reçu pour ses détails ou son document.' },
  { path: '/account/deliveries', title: 'Mes livraisons', text: 'Suivez les informations de livraison liées à vos commandes.', controls: 'Chaque entrée montre l’avancement de la livraison et permet d’ouvrir la commande associée.' },
  { path: '/account/activity', title: 'Mon historique', text: 'Parcourez l’activité enregistrée sur votre compte.', controls: 'La liste est chronologique et n’affiche que les événements renvoyés pour votre compte.' },
  { path: '/account/profile', title: 'Mon profil', text: 'Vérifiez et mettez à jour vos informations personnelles.', controls: 'Le formulaire photo permet de choisir puis envoyer une image; les champs modifiables se sauvegardent avec « Enregistrer ». E-mail, catégorie et identifiant ULC sont en lecture seule.' },
];

export function GuidedTour({ mode }: Props) {
  const path = usePathname();
  const router = useRouter();
  const steps = useMemo(() => mode === 'client' ? accountSteps : publicSteps, [mode]);
  const [active, setActive] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const [index, setIndex] = useState(0);
  const [ready, setReady] = useState(false);

  function restoreTour() {
    try {
      const saved = sessionStorage.getItem('jami-client-tour-state');
      if (!saved) return;
      const state = JSON.parse(saved) as { active?: boolean; index?: number; mode?: string };
      if (state.active && state.mode === mode) { setActive(true); setIndex(Math.max(0, Math.min(state.index ?? 0, steps.length - 1))); }
    } catch { /* reprise facultative */ }
  }

  useEffect(() => {
    setReady(true);
    if (mode === 'loading') return;
    restoreTour();
    try {
      const seen = localStorage.getItem('jami-client-tour-seen');
      const eligible = mode === 'client' ? path === '/account' : path === '/auth' || path === '/home';
      if (eligible && !seen) setPrompt(true);
    } catch { /* Le guide reste relançable même si le stockage est indisponible. */ }
  }, [mode, path]);

  useEffect(() => {
    try { sessionStorage.setItem('jami-client-tour-state', JSON.stringify({ active, index, mode })); } catch { /* reprise facultative */ }
  }, [active, index, mode]);

  useEffect(() => {
    const handleStart = () => startTour();
    window.addEventListener('jami-tour-start', handleStart);
    return () => window.removeEventListener('jami-tour-start', handleStart);
  });

  useEffect(() => {
    if (active) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [active, index, path]);

  function dismissPrompt() {
    setPrompt(false);
    try { localStorage.setItem('jami-client-tour-seen', '1'); } catch { /* stockage facultatif */ }
  }

  function startTour() {
    setPrompt(false);
    const initialIndex = mode === 'client' ? accountSteps.findIndex(step => step.path === path) : publicSteps.findIndex(step => step.path === path);
    const nextIndex = initialIndex >= 0 ? initialIndex : 0;
    setIndex(nextIndex);
    setActive(true);
    try { localStorage.setItem('jami-client-tour-seen', '1'); } catch { /* stockage facultatif */ }
    if (path !== steps[nextIndex].path) router.push(steps[nextIndex].path);
  }

  function goTo(nextIndex: number) {
    if (nextIndex < 0) return;
    if (nextIndex >= steps.length) { setActive(false); try { sessionStorage.removeItem('jami-client-tour-state'); } catch {} return; }
    setIndex(nextIndex);
    if (path !== steps[nextIndex].path) router.push(steps[nextIndex].path);
  }

  if (!ready) return null;
  return <>
    {mode !== 'loading' && <button type="button" className="tour-launch" onClick={startTour} aria-label="Lancer la visite guidée">?</button>}
    {prompt && !active && <div className="tour-backdrop" role="presentation"><section className="tour-card tour-welcome" role="dialog" aria-modal="true" aria-labelledby="tour-welcome-title">
      <span className="tour-kicker">JAMI FOOD · VISITE GUIDÉE</span><h2 id="tour-welcome-title">Première visite ?</h2><p>Découvrez les écrans du site en quelques étapes. Vous pourrez arrêter ou relancer le guide à tout moment.</p>
      <div className="tour-actions"><button className="button button-dark" onClick={startTour}>Commencer <span aria-hidden="true">→</span></button><button className="tour-text-button" onClick={dismissPrompt}>Plus tard</button></div>
    </section></div>}
    {active && <div className="tour-backdrop" role="presentation"><section className="tour-card" role="dialog" aria-modal="false" aria-live="polite" aria-labelledby="tour-step-title">
      <div className="tour-card-top"><span className="tour-kicker">VISITE GUIDÉE · {mode === 'client' ? 'MON COMPTE' : 'DÉCOUVERTE'}</span><button className="tour-close" onClick={() => {setActive(false); try {sessionStorage.removeItem('jami-client-tour-state');} catch {}}} aria-label="Fermer la visite">×</button></div>
      <div className="tour-progress" aria-label={`Étape ${index + 1} sur ${steps.length}`}><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
      <span className="tour-count">ÉTAPE {index + 1} / {steps.length}</span><h2 id="tour-step-title">{steps[index].title}</h2><p>{steps[index].text}</p><p className="tour-controls"><b>À quoi servent les commandes :</b> {steps[index].controls}</p>
      {index === steps.length - 1 && mode !== 'client' && <p className="tour-login-hint">Après connexion, relancez le guide pour découvrir tous les écrans de votre compte.</p>}
      <div className="tour-actions tour-step-actions"><button className="tour-text-button" onClick={() => goTo(index - 1)} disabled={index === 0}>← Précédent</button><button className="button button-dark" onClick={() => goTo(index + 1)}>{index === steps.length - 1 ? 'Terminer' : 'Suivant →'}</button></div>
    </section></div>}
  </>;
}
