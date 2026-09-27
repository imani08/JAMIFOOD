# Front-office JAMI FOOD

## Objectif

`apps/client` est l’interface séparée destinée aux visiteurs et aux clients. Elle
utilise le même service API que le back-office, mais possède son propre layout,
ses routes, sa navigation et son style. Elle écoute par défaut sur le port 3002.

## Parcours et routes

- `/` : splash animé puis choix connexion, création de compte ou visiteur.
- `/welcome` : présentation de JAMI FOOD.
- `/menu`, `/cart` : entrée catalogue et panier local estimatif.
- `/login`, `/register`, `/forgot-password`, `/reset-password` : entrée compte.
- `/account` : Mon JAMI FOOD et raccourcis abonnement, droits, QR, commandes,
  paiements, reçus, livraisons, historique et profil.
- `/orders`, `/orders/[id]`, `/track-order` : points d’entrée de suivi.

## Sécurité et contrats

Le navigateur n’accède jamais à Prisma. `app/lib/api.ts` centralise les futures
requêtes same-origin vers `/api/v1`, cookies, délais et erreurs. Les opérations
client privées devront être servies par `/api/v1/client/*` et déduire le client
de la session HttpOnly; elles ne devront jamais prendre un `clientId` navigateur
comme identité. Les informations publiques relèvent de `/api/v1/public/*`.
Les routes internes personnel ne sont pas des contrats client.

L’API du portail est fournie par `apps/api/src/client-portal.ts`: inscription ULC
avec session client distincte, connexion, déconnexion, profil, données privées,
commandes et QR. Le menu public lit uniquement la version publiée du menu et son
instantané tarifaire. Le tarif affiché au visiteur provient exclusivement de la
catégorie configurée dans `PUBLIC_PRICE_CATEGORY_CODE`; s’il n’est pas renseigné,
le menu reste indisponible au lieu d’inventer un prix.

L’installation requiert les migrations Prisma. `QR_TOKEN_ENCRYPTION_KEY` doit
être une clé hexadécimale aléatoire de 32 octets, conservée dans le gestionnaire
de secrets, et `COOKIE_SECURE=true` en production. Le back-office propose la
validation des inscriptions dans « Vérification ULC »; une demande reste
`PENDING` jusque-là. Les commandes sont créées avec les prix figés dans le menu
publié et doivent ensuite être payées/confirmées à la caisse. Aucun flux de
paiement en ligne n’est activé.

La commande visiteur sans compte, la récupération de mot de passe et les reçus
PDF exigent encore des contrats et contrôles complémentaires (token de suivi
invité, envoi e-mail vérifié, numérotation/format fiscal). Le dépôt ne comporte
pas ces mécanismes; leurs écrans ne les présentent donc pas comme actifs.

## Design

Le style dédié est dans `apps/client/app/styles.css`: palette crème, baie et or,
typographie éditoriale, splash avec animation réduite selon la préférence système,
adaptation smartphone et navigation mobile. Aucun QR personnel n’est créé côté
client; l’API devra fournir un jeton opaque révocable.

Les conventions de décisions sont dans `FRONT_OFFICE_DECISIONS.md`.
