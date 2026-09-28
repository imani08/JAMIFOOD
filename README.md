# JAMI FOOD

Plateforme de gestion opérationnelle du restaurant ULC. Consultez
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`DATA_MODEL.md`](DATA_MODEL.md) et
[`COMPLIANCE_MATRIX.md`](COMPLIANCE_MATRIX.md) avant une mise en production.

## Développement avec Docker Compose

1. Copier `.env.example` vers `.env` et remplacer chaque secret.
2. Démarrer les services : `docker compose up -d`.
3. Vérifier leur état : `docker compose ps`.
4. Consulter tous les journaux : `docker compose logs -f` (ou `docker compose logs -f api`).
5. Arrêter volontairement les services sans supprimer leurs données : `docker compose stop`.
6. Les redémarrer : `docker compose restart`.

Les services persistants du Compose ont `restart: unless-stopped`. Docker les
relance après le démarrage de son moteur, sauf s'ils ont été explicitement
arrêtés. PostgreSQL monte le volume nommé `postgres_data` sur
`/var/lib/postgresql/data`; ses données survivent à l'arrêt et au remplacement
des conteneurs. Le healthcheck `pg_isready` conditionne le démarrage de l'API,
et les interfaces attendent l'état healthy de l'API lors d'un `compose up`.

Pour supprimer les conteneurs tout en conservant les volumes, utiliser
`docker compose down`. **Ne pas utiliser `docker compose down -v`** : l'option
`-v` supprime les volumes nommés et donc les données PostgreSQL. Ne pas lancer
`prisma db push`, de reset ou de migration destructive pour redémarrer Compose.

Pour vérifier le redémarrage automatique du moteur : lancer `docker compose up -d`,
confirmer `docker compose ps`, redémarrer Docker Desktop / Docker Engine,
attendre que le moteur soit disponible puis exécuter de nouveau
`docker compose ps` et vérifier le volume PostgreSQL. Ce test n'est réussi que
si le moteur Docker a réellement été redémarré. Les données de démonstration
doivent être chargées uniquement volontairement avec
`SEED_DEMO=true pnpm db:seed` en développement, jamais automatiquement en
production.

PostgreSQL est volontairement lié à `127.0.0.1` en développement et n'est pas
exposé dans la surcharge production.

## Paiement carte / TPE

Le POS utilise le même modèle `Payment` et les mêmes sessions de caisse. Le
mode se règle côté API avec `TPE_MODE=MOCK` (développement/test), `MANUAL`
(terminal bancaire indépendant) ou `INTEGRATED` (bloqué tant qu’un adaptateur
officiel n’est pas installé). MOCK expose les résultats simulés et ne contacte
aucune banque; en cas de délai dépassé ou statut inconnu, le paiement reste
`PENDING`. MANUAL demande uniquement la référence non sensible du ticket TPE,
puis une confirmation soumise à `payments.confirm`. Le POS reçoit le solde
restant dû, et un paiement CARD confirmé crée un mouvement `DIGITAL_IN`.

Les variables `TPE_PROVIDER`, `TPE_TERMINAL_ID`, `TPE_MERCHANT_ID`,
`TPE_API_URL` et `TPE_API_KEY` sont réservées au futur adaptateur serveur.
Elles ne doivent jamais être exposées au navigateur. Aucun remboursement
bancaire TPE n’est déclaré disponible avant le branchement d’un fournisseur.
