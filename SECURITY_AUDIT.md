# Audit sécurité et matrice RBAC

État du dépôt contrôlé le 26/09/2026. Les permissions d’API NestJS restent la
source d’autorité. Les gardes de page web empêchent aussi le rendu du contenu
et le lancement des requêtes de page quand le compte n’a pas la permission.

## Matrice des pages

| Route | Permission | Rôles ayant l’accès dans le seed |
| --- | --- | --- |
| `/` | Session valide | Tous les rôles du back-office |
| `/pos` | `sales.create` | Direction, Responsable, Caissier |
| `/orders` | `orders.read` | Direction, Responsable, Caissier |
| `/kitchen` | `kitchen.read` | Direction, Responsable, Cuisine |
| `/delivery` | `delivery.read` | Direction, Responsable, Livreur |
| `/clients` | `clients.read` | Direction, Responsable, Caissier |
| `/subscriptions` | `subscriptions.read` | Direction, Responsable, Caissier |
| `/meals` | `meal.validate` | Direction, Responsable, Caissier |
| `/products` | `pricing.read` | Direction, Responsable, Caissier |
| `/menus` | `menus.read` | Direction, Responsable, Cuisine |
| `/stock` | `stock.read` | Direction, Responsable, Gestionnaire stock |
| `/cash` | `cash.read` | Direction, Responsable, Caissier |
| `/expenses` | `cash.expense` | Direction, Responsable |
| `/reports` | `reports.read` | Direction, Responsable |
| `/audit` | `audit.read` | Direction, Responsable |
| `/users` | `users.read` | Direction, Admin technique |
| `/settings` | `pricing.read` | Direction, Responsable |

L’affectation des livraisons est restreinte par l’API à `delivery.assign`
(Direction et Responsable). Un livreur ne reçoit que les commandes associées à
son identifiant.

## Contrôles inspectés et changements

- Chaque endpoint de contrôleur métier porte un `@Require` spécifique. Les
  seules routes publiques sont la connexion, les sondes de santé et les images
  de produits publiques. `/auth/me`, logout et changement de mot de passe ont
  maintenant des permissions de session explicites.
- `AccessGuard` vérifie toutes les permissions de la liste (`some` signifie
  qu’une seule permission requise manquante suffit au refus). Aucun décorateur
  `@Require` empilé n’a été trouvé dans les contrôleurs actifs.
- Les permissions d’annulation (`orders.cancel`) et de remboursement
  (`cash.refund`) sont distinctes de la lecture/vente. L’Admin technique ne
  possède aucune permission financière par défaut.
- Les caisses sont associées à l’utilisateur courant via `lockCash`; le
  changement de rôle de son propre compte est interdit; les utilisateurs
  désactivés perdent leurs sessions.
- L’affectation préalable d’une livraison est requise. La transition en cours
  et la remise vérifient le livreur associé.
- Le cookie de session est HttpOnly et SameSite Strict. Le jeton aléatoire de
  256 bits est stocké sous forme SHA-256, avec expiration absolue de 8 heures
  et expiration d’inactivité configurable (30 minutes par défaut). Le
  changement de mot de passe invalide les sessions. Argon2id est utilisé pour
  les nouveaux mots de passe; le vérificateur conserve temporairement le format
  scrypt des comptes de démonstration existants.
- Toute mutation exige l’origine configurée et `x-jami-request: 1`. CORS utilise
  la liste explicite `WEB_ORIGIN`; la production refuse les origines wildcard,
  non HTTPS et l’absence de `COOKIE_SECURE=true`. Swagger n’est pas monté en
  production. Helmet est activé.
- Les images produits sont décodées puis réencodées par Sharp; les photos
  clients vérifient leur signature; limites de taille, noms UUID et stockage
  hors du répertoire public sont appliqués. Les photos client exigent
  `clients.read`.
- Les mutations métier journalisent leurs événements dans `AuditLog`; les
  triggers PostgreSQL interdisent la modification et la suppression des lignes
  d’audit et de mouvements de caisse/stock.
- `.env` est ignoré par Git. Les fichiers de déploiement production ne publient
  pas de port PostgreSQL.

## Tests et limites restant à traiter

Des cas RBAC multi-rôles ont été ajoutés à `apps/api/test/integration.cjs` :
annulation par caissier, lecture abonnement et client par Cuisine, rapports par
Livreur, règlement fournisseur par Stock, remboursement par Admin technique,
requête d’origine étrangère et affectation/livraison avec un autre utilisateur.
Les refus vérifient le 403 et l’absence de champ `data`.

La suite automatique `pnpm test` passe. La suite PostgreSQL ne peut pas être
exécutée dans cet environnement car le conteneur `jami-food-dev-db` est absent.
Le build web Next.js a démarré mais n’a pas progressé après plus de deux minutes;
il a été interrompu. Les vérifications TypeScript API et web réussissent.

Ce contrôle statique et les tests disponibles ne certifient pas une revue de
production complète. Avant déploiement, il reste à ajouter une limitation
distribuée sur changement de mot de passe, QR, confirmation/remboursement et
uploads; à tester les accès IDOR avec une base intégration active pour chaque
rôle; et à valider TLS/HSTS, CSP, secrets et l’exposition réseau sur
l’infrastructure effectivement déployée. Le bruteforce de connexion est limité
par compte en base, mais pas encore par adresse IP.
