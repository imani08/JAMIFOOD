# Développement avec Docker

La configuration par défaut `docker-compose.yml` est réservée au développement : PostgreSQL 16, API NestJS, back-office Next.js et front-office Next.js. Elle n’utilise pas les images runtime de production.

## Démarrer

Copier `.env.example` vers `.env` si nécessaire, puis lancer à la racine :

```sh
docker compose up --build
```

Accès :

- Front-office : http://localhost:3002
- Back-office : http://localhost:3000
- API : http://localhost:3001/api/v1
- Santé API : http://localhost:3001/api/v1/health
- PostgreSQL : `127.0.0.1:5432` (base `jami_food`, utilisateur `jami`)

Les commandes usuelles sont `docker compose down`, `docker compose ps`, `docker compose logs -f api|web|client` et `docker compose exec api sh`. Les données PostgreSQL, images produits et photos de profil sont gardées par les volumes `postgres_data`, `product_images` et `client_photos`. `docker compose down` les conserve; `docker compose down -v` les supprime volontairement.

## Modèle, dépendances et migrations

Prisma Client est généré pour Linux lors du build des images. Après une modification du schéma, lancer explicitement :

```sh
docker compose exec api pnpm --filter @jami/database generate
docker compose exec api pnpm --filter @jami/database run migrate
```

`migrate` utilise `prisma migrate dev`. Pour appliquer seulement des migrations déjà créées :

```sh
docker compose exec api pnpm --filter @jami/database run deploy
```

Aucune migration ni réinitialisation de base n’est lancée automatiquement au démarrage. Si les dépendances changent dans un `package.json`, reconstruire l’image correspondante avec `docker compose build api|web|client`, puis redémarrer le service. Le code source et les packages workspace sont montés depuis l’hôte pour le rechargement à chaud; les `node_modules` Windows et ceux de l’hôte sont masqués par des volumes Linux Docker.

## Variables locales

`.env.example` donne les valeurs de développement. Compose transmet au réseau Docker une URL PostgreSQL utilisant l’hôte `postgres`; les applications navigateur utilisent `http://localhost:3001/api/v1`, tandis que les rewrites Next côté serveur utilisent `http://api:3001`. Les origines autorisées sont `http://localhost:3000` et `http://localhost:3002`; `COOKIE_SECURE=false` est prévu pour HTTP local. Ne placez aucun secret de production dans cet environnement.

Pour créer et récupérer les QR clients, `QR_TOKEN_ENCRYPTION_KEY` doit contenir 64 caractères hexadécimaux aléatoires (32 octets); gardez la même clé entre redémarrages et sauvegardez-la hors du dépôt.

## E-mails client en développement

En développement, si aucun fournisseur e-mail n’est configuré, le front affiche un lien local de vérification à usage unique; aucun e-mail n’est prétendu envoyé. Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` et `CLIENT_PUBLIC_URL` dans `.env` pour l’envoi SMTP (TLS/STARTTLS pris en charge), ou utilisez `RESEND_API_KEY` avec `MAIL_FROM`. Les deux fournisseurs envoient les e-mails de vérification et de récupération. Ces valeurs ne doivent jamais être commitées; sans fournisseur configuré, l’API indique que le message n’a pas été envoyé. En développement local Docker, les photos de profil sont enregistrées dans le volume `client_photos`.

Les dossiers sources de l’API, des deux applications Next et des packages workspace sont montés depuis l’hôte. Les serveurs surveillent les changements avec le polling adapté aux montages Windows/Docker Desktop; les modifications TypeScript API sont recompilées et Next recharge ses pages. Les volumes `.next` sont séparés pour éviter d’utiliser des artefacts Windows.

Après une modification dans `packages/shared`, `packages/validation` ou `packages/database/src`, reconstruire le package concerné dans le conteneur API puis redémarrer l’API afin qu’elle recharge son `dist` :

```sh
docker compose exec api pnpm --filter @jami/shared build
docker compose restart api
```

Remplacer `@jami/shared` par `@jami/validation` ou `@jami/database` selon le package modifié. Les changements du schéma Prisma nécessitent aussi `generate` et une migration explicite comme indiqué ci-dessus.
