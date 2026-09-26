# Décisions front-office JAMI FOOD

## DECISIONS CONFIRMÉES

- Le front-office vit dans `apps/client`, séparé de `apps/web` et de l’API.
- Son port de développement est 3002; l’API reste sur 3001 et le back-office
  sur 3000.
- Le splash et l’écran d’accueil offrent connexion, création de compte et accès
  visiteur. Le visiteur peut parcourir les fonctionnalités publiques.
- La création de compte est réservée aux étudiants ULC (résidents Home ou
  externes ULC) et au personnel ULC. Une demande commence en vérification
  `PENDING`; une déclaration ne confère pas d’avantage de catégorie.
- Un compte client est indépendant de l’existence d’un abonnement.
- Les données personnelles doivent venir d’une session client et être
  limitées à leur propriétaire. Le QR ne contiendra qu’un identifiant opaque.
- Le menu et les prix ne sont pas codés en dur. Le panier est une estimation;
  le serveur devra recalculer tout prix de commande.
- Aucun compte visiteur externe n’est créé.

## DÉCISIONS À PRENDRE

- Aucun détail restant n’est nécessaire au parcours d’interface initial. Avant
  activation opérationnelle, définir les contrats et procédures techniques
  d’enrôlement/vérification, d’authentification et de récupération de compte,
  de publication d’un tarif visiteur, de suivi sécurisé d’une commande invitée,
  de paiement client et de commande/livraison. Tant qu’ils ne sont pas déployés,
  l’interface n’annonce pas ces opérations comme disponibles.
