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

## CONFIGURATION OPÉRATIONNELLE RESTANTE

- Déployer les migrations Prisma avant de lancer l’API.
- Configurer `PUBLIC_PRICE_CATEGORY_CODE` avec le code de catégorie commerciale
  réellement approuvé pour les visiteurs; sans valeur, le menu ne publie aucun
  tarif.
- Générer `QR_TOKEN_ENCRYPTION_KEY` comme 32 octets hexadécimaux aléatoires et
  la conserver dans le gestionnaire de secrets. Sans clé, les QR ne sont pas
  émis.
- Configurer `COOKIE_SECURE=true` et les origines HTTPS de production.
- Les commandes créées depuis un compte sont encaissées à la caisse. Le suivi
  d’une commande invitée, la récupération e-mail de mot de passe, le paiement en
  ligne et le reçu fiscal PDF demeurent hors périmètre activé jusqu’à
  l’implémentation de leurs mécanismes dédiés.
