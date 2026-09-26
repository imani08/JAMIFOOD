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

À ce stade, l’API du dépôt ne possède pas encore de session client ni de routes
`public`/`client`. Les écrans correspondants affichent donc des états vides ou
expliquent que les données personnelles nécessitent une connexion, sans afficher
de produits, prix, soldes ou commandes fictifs. Le panier navigateur ne valide
jamais un prix ni une commande.

## Design

Le style dédié est dans `apps/client/app/styles.css`: palette crème, baie et or,
typographie éditoriale, splash avec animation réduite selon la préférence système,
adaptation smartphone et navigation mobile. Aucun QR personnel n’est créé côté
client; l’API devra fournir un jeton opaque révocable.

Les conventions de décisions sont dans `FRONT_OFFICE_DECISIONS.md`.
