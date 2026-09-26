# Audit réel du back-office — 26 septembre 2026

Source fonctionnelle : `../Cahier DES CHARGES JAMI FOOD.docx`, lu en entier,
complété par la mission de finalisation (sections 0–58). Cet état décrit le
code avant ce lot. `DONE` exige une preuve de recette ; une route ou un modèle
isolé reste `PARTIAL`. Les exigences optionnelles du portail restent hors périmètre.

| Exigence | État actuel | Manque | Fichier concerné | Action |
| --- | --- | --- | --- | --- |
| Démarrage après clone Windows/Linux | PARTIAL | env API/Prisma absent, builds manuels packages | scripts/start-local.sh, package.json, main.ts | Lanceur Node portable, chargement env et graphe Turbo |
| Schéma PostgreSQL et migrations | PARTIAL | unique paiement interdit acomptes ; FK métier incomplètes | schema.prisma, migrations/202609250001_initial | Migrations additives, pas reset |
| Connexion, sessions, CSRF | PARTIAL | tests complets, audit refus, contrôles limites | auth.ts | Renforcer + conserver session HttpOnly |
| Administration utilisateurs/multirôles | MISSING | création, modification, activation, habilitations | catalog.ts, users/page.tsx | Module utilisateurs dédié et contrôles délégation |
| Séparation admin technique/finance | PARTIAL | seed et tests par tous profils | seed.ts | Matrice permissions explicite et 7 profils DEMO |
| Paramètres à valider | PARTIAL | lecture seulement, aucun historique/approbation | catalog.ts, Setting | Versionner, valider, bloquer règles non validées |
| Catalogue et catégories | PARTIAL | CRUD, disponibilité, unités/options | catalog.ts, Product | Administration complète sans suppression historique |
| Prix versionnés | PARTIAL | dates futures, approbation, version choisie cohérente | catalog.ts, orders.ts | Versions applicables datées et snapshots |
| Menus | MISSING | modèles et routes/pages absents | schema.prisma, apps/web | Menu, versions, articles, publication, retrait |
| Clients | PARTIAL | fiche, modification/archive/fusion/historique | clients.ts | Contrôles doublons + conservation opérations |
| Photos et allergies | MISSING | endpoints privés et restrictions | Client, clients.ts | Stockage privé, validation, permissions et chiffrement |
| QR imprimable/téléchargeable | PARTIAL | seulement token, token en clair dans cache idempotence | clients.ts, clients/page.tsx | Générer PNG côté client, chiffrer replay, révocation/historique |
| Scanner caméra et recherche manuelle | MISSING | contrôle par token seulement | meals/page.tsx | Caméra + recherche mêmes contrôles backend |
| Consommation concurrente | PARTIAL | contexte service/point remise, recette réelle | meals.ts, integration.cjs | Compléter contexte et tests deux connexions |
| Dérogation et correction repas | MISSING | opération liée append-only | meals.ts, schema.prisma | Politique validée et preuve non-remise |
| Souscription datée D+29 | PARTIAL | CRUD plans, renouvellement, suspension, reprise | subscriptions.ts | Versions validées et événements |
| Paiement partiel abonnement | MISSING | settlement exige solde complet, index unique | subscriptions.ts, migration initiale | Ventilation paiements, politique acompte séparée |
| Quotas et chevauchements | PARTIAL | quota service/période configurable, règles cumul | subscriptions.ts, MealRight | Invariants et tests R01–R05 |
| POS | PARTIAL | client, livraison, variantes, suppléments, devise | pos/page.tsx, orders.ts | Catalogue réel, snapshots serveur |
| Remises | BLOCKED_BY_BUSINESS_DECISION | seuil/approbation non validés ; technique absente | Setting, orders.ts | Implémenter règle inactivée par défaut |
| Paiements USD/CDF/externe | PARTIAL | plusieurs règlements, échéances, historique | orders.ts, Payment | Verrous agrégat, montant restant et ledger |
| Arrondis | BLOCKED_BY_BUSINESS_DECISION | politique production à valider | settlement, Setting | Refuser conversion non exacte sans règle |
| Reçus | PARTIAL | duplicata tracé, détail agent/caisse, vrai PDF | orders.ts, orders/page.tsx | Documents distincts et téléchargement |
| Commandes/annulation | PARTIAL | filtres et annulation motivée selon étape | orders.ts | Transition auditée, effets séparés |
| Remboursements/régularisations | MISSING | aucun modèle/route | schema.prisma, cash.ts | Append-only, référence originale, politique |
| Cuisine | PARTIAL | livraison rejetée à toute transition | orders.ts, kitchen/page.tsx | Préparation livraison et remise sans double consommation |
| Livraison | MISSING | modèle sans parcours | Delivery | Affectation, IDOR, remise/échec auditée |
| Caisse | PARTIAL | transferts/dépôts, dépenses numériques | cash.ts | Ledger dédié et rapprochement séparé |
| Clôture aveugle | PARTIAL | pagination/IDOR rapports et exports complets | cash.ts | Contrôles serveur et tests R10/R11 |
| Stock/inventaire | PARTIAL | lots, péremption, UI parcours complets | stock.ts, stock/page.tsx | Conserver blocage négatif, mouvements uniques |
| Fournisseurs/achats | PARTIAL | pas lignes achats ni factures, réceptions non bornées | stock.ts, Purchase | Distinguer commande/réception/facture/paiement |
| Recettes/production | PARTIAL | permissions cuisine, versions, prévisions et pertes | stock.ts, RecipeVersion | Déduction unique à validation |
| Vente de produit stocké | MISSING | pas lien produit-stock ni déstockage | Product, orders.ts | Mode déstockage explicite |
| Rapports | PARTIAL | seulement jour courant, rendu devises confondu | catalog.ts, reports/page.tsx | Filtres et rapprochement sur snapshots |
| Exports PDF/XLSX/CSV | PARTIAL | CSV clôture seul ; pas XLSX | cash.ts, reports | Exports RBAC et neutralisation formules |
| Audit | PARTIAL | trigger append-only présent, corrélation partielle | transaction.ts, AuditLog | Request context, événements complets et pagination |
| Offline/LAN/edge | MISSING | bannière réseau seule ; pas outbox/autorité | shell.tsx, SyncOperation | Autorité unique, file persistée, conflits explicites |
| Sauvegarde/restauration | PARTIAL | script manuel, pas preuve restauration | scripts/backup-postgres.sh | Automatisation, vérification et exercice isolé |
| Sécurité uploads | MISSING | aucun upload | apps/api | MIME/signature/taille, pas chemin client |
| Tests R01–R16 | PARTIAL | script tests partiel non exécuté ici, Docker nom codé | integration.cjs | Base test isolée + API/E2E/concurrence |
| CI | PARTIAL | sans PostgreSQL/generate/migrations, lint sans config | .github/workflows/ci.yml | Pipeline réellement exécutable |
| Déploiement | PARTIAL | liens pnpm runtime manquants, host loopback, pas TLS | Dockerfile.api, nginx | Images et réseau privé contrôlés |
| Comptes DEMO | PARTIAL | seulement 3 profils, hash scrypt initial | seed.ts | 7 comptes, Argon2id, DEMO_PASSWORD uniquement |

## Ordre et critères

1. Corriger environnement et outillage ; valider schéma existant avant extension.
2. Auth/utilisateurs, catalogue/menus et clients/QR en lots disjoints ; chaque
   évolution SQL conserve la migration initiale et les données existantes.
3. Règlements partiels/mixtes, abonnements, cuisine/livraison, régularisations.
4. Phase 2, rapports, continuité, sauvegardes et déploiement.
5. Recette API/PostgreSQL/E2E, matrice finale et commandes de lancement.

Les règles commerciales non approuvées seront représentées comme paramètres
`À VALIDER` et bloqueront uniquement leurs workflows dépendants. Ce statut ne
doit pas servir à masquer une implémentation technique manquante.

## Vérification initiale

- `pnpm --version` : 10.18.2 ; dépendances Next/Nest présentes.
- `pnpm --filter @jami/database validate` : échec P1012, `DATABASE_URL` non
  chargé depuis la racine du workspace. Correction nécessaire du lanceur.
- Moteur Docker non joignable dans cet environnement au début de l'audit.
- Dépôt Git dédié sans commit ; fichiers existants conservés, aucun reset.
