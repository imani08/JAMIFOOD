# Architecture — JAMI FOOD

## 1. Périmètre et décision d'architecture

Ce document couvre l'analyse et la conception de la **phase 1** demandée. Le
stock, les achats, la production et les coûts restent des modules de phase 2,
isolés du socle opérationnel. Les intégrations Mobile Money, le portail client,
le portefeuille et les notifications sortantes sont des extensions optionnelles.

Priorité de conception : intégrité des données, sécurité, traçabilité,
cohérence financière, concurrence/idempotence, disponibilité, performance,
puis ergonomie.

Architecture retenue : monorepo pnpm (Turborepo si les temps de build le
justifient), Next.js et NestJS séparés, PostgreSQL comme autorité de données.
En fonctionnement connecté, aucune règle financière ou de consommation n'est
exécutée uniquement dans le navigateur.

```text
Navigateur/PWA ──HTTPS──> Nginx ─┬─> apps/web (Next.js)
                                 └─> apps/api (NestJS REST)
                                              │
                                      PostgreSQL privé
                                              │
                              stockage objet privé (uploads)
```

Pour une coupure Internet multi-guichet, une PWA seule ne suffit pas. Le mode
offline multi-POS requiert un **Local Edge Server** (NestJS + PostgreSQL local)
sur le LAN : il devient l'autorité temporaire des opérations autorisées et
synchronise ensuite vers le cloud. En l'absence de cet équipement, le mode
secours n'autorise qu'un poste désigné à valider les droits abonnés.

## 2. Exigences analysées

### Fonctionnelles phase 1

- Identités, authentification, rôles/permissions fines et journal d'audit
  immuable via l'application.
- Clients, catégories, données alimentaires sensibles protégées, détection et
  fusion de doublons, QR opaques révocables.
- Formules, versions tarifaires, abonnements, droits, réservations et
  consommation explicite des repas.
- POS : catalogue, panier, commande, paiement confirmé, rendu USD/CDF, reçu
  financier et bon de cuisine distincts.
- Cuisine : prise en charge, préparation, prêt, remise unique ; livraison
  mobile avec visibilité limitée aux données nécessaires.
- Sessions de caisse, mouvements, dépenses, comptage aveugle, clôture validée
  non modifiable et régularisations.
- Menus/versionnement, rapports essentiels, exports autorisés, PWA et
  synchronisation journalisée.

### Non fonctionnelles

- Next.js App Router, React, TypeScript strict, Tailwind, shadcn/ui, RHF,
  Zod, TanStack Query/Table, PWA et IndexedDB ; NestJS REST, Swagger ; Prisma
  + PostgreSQL ; Docker, CI, logs structurés et sauvegardes.
- Fuseau métier `Africa/Kinshasa` ; instants stockés en UTC et dates métier
  calculées dans ce fuseau. Une période de 30 jours de D se termine à D+29.
- Français pour les textes utilisateur ; erreurs API stables et corrélées par
  `requestId` ; pagination et recherche côté serveur.
- Objectifs : droits après QR ≤ 1 s et 95 % des interactions usuelles POS ≤ 2 s.

## 3. Monorepo cible

```text
apps/
  web/                 # Next.js : dashboard, POS, cuisine, livreur, PWA
  api/                 # NestJS : REST, règles métier, Swagger, sync
packages/
  database/            # Prisma schema, migrations, seed explicitement DEV
  shared/              # enums, contrats API, constantes non sensibles
  validation/          # schémas Zod de frontières partagés
  ui/                  # composants shadcn/ui adaptés au projet
  config/              # ESLint, TS, Tailwind, conventions partagées
docs/                  # documentation opératoire supplémentaire
```

`apps/web` ne porte que l'état de présentation, la cache Query, les files
offline et les validations UX. `apps/api` applique les autorisations, les
transitions, la validation et les transactions. Les packages ne contiennent
aucun secret.

## 4. Modules backend et frontières

| Module | Responsabilité principale |
| --- | --- |
| auth / users / rbac | sessions, MFA future, anti-brute-force, permissions |
| clients / qrcodes | profil, confidentialité, QR opaque et historique |
| plans / pricing / subscriptions | versions, échéances, solde, droits |
| meals | réservation et consommation concurrente des MealRight |
| products / menus | catalogue et snapshots d'articles/menu |
| orders / tickets / kitchen | commande, documents, machine d'états cuisine |
| payments / exchange-rates | confirmations et snapshots monétaires |
| cash / expenses | session, mouvements, comptage, clôture, régularisation |
| delivery | affectation et preuve de remise à usage unique optionnelle |
| audit | écriture append-only, consultation permissionnée |
| sync / devices | outbox offline, idempotence et conflits visibles |
| reports | lectures agrégées séparant CA, encaissement et trésorerie |

Les contrôleurs sont fins ; les services métier composent les repositories
Prisma et les transactions. Chaque mutation sensible requiert permission,
acteur, `Idempotency-Key` et événement d'audit dans la même transaction lorsque
possible.

## 5. Modèle de sécurité

- Mot de passe Argon2id, cookies de session `HttpOnly`, `Secure`, `SameSite`,
  rotation/expiration/inactivité ; CSRF pour les flux cookie ; rate limit sur
  login et mutations sensibles. MFA est imposée comme capacité configurable
  pour les comptes privilégiés après décision métier.
- RBAC backend : une permission explicite, jamais la seule dissimulation d'un
  bouton. Des permissions de fusion de clients, lecture allergies et
  régularisation sont distinctes.
- Zod/class-validator en frontière, DTO allow-listés, contrôle d'accès objet
  (IDOR), CSP/headers, protection XSS, request IDs et journal de sécurité.
- Les QR et tickets sont des jetons opaques, aléatoires et révocables : aucune
  PII, solde ou droit ne s'y trouve. Le scan identifie ; il ne sert jamais.
- Stockage S3-compatible privé pour photos/justificatifs, contrôle MIME/taille,
  URLs signées courtes. Ni CVV, carte complète, PIN ni secrets Mobile Money.

## 6. RBAC de départ

Rôles : `DIRECTION`, `RESPONSABLE_RESTAURANT`, `CAISSIER`, `CUISINE`,
`GESTIONNAIRE_STOCK`, `LIVREUR`, `ADMIN_TECHNIQUE`, `CLIENT`.

Les permissions listées dans le cahier sont des enregistrements seedés, non des
tests de rôle codés en dur. Le rôle donne un ensemble de permissions et un
utilisateur peut avoir plusieurs rôles. Les permissions `stock.*` restent
présentes mais ne rendent aucun workflow phase 2 actif avant son implémentation.

## 7. Workflows invariants

### Abonnement et repas

```text
QR scan -> lecture profil/droits -> action explicite "Repas servi"
        -> verrou MealRight AVAILABLE -> CONSUMED -> MealConsumption + audit
```

La consommation prend un verrou PostgreSQL (`SELECT ... FOR UPDATE`) sur le
droit candidat et vérifie abonnement actif, date/service/quota et statut. Une
contrainte unique empêche plus d'une consommation du même droit. Pour une
livraison : `AVAILABLE -> RESERVED -> commande -> préparation -> livraison
confirmée -> CONSUMED`. Une annulation libère/restaure selon une règle validée,
jamais par mise à jour silencieuse.

### Vente au POS et cuisine

```text
Order draft + items/snapshots -> Payment PENDING/CONFIRMED
-> Order CONFIRMED -> reçu financier + bon de cuisine -> PREPARING
-> READY -> SERVED
```

Le paiement confirmé précède l'envoi normal en cuisine. La commande conserve un
numéro `CMD-YYYY-xxxxx`, le même à tous les états. Le reçu financier prouve le
paiement ; le bon de cuisine contient seulement les données de préparation.
`SERVED` est une transition transactionnelle conditionnelle : une seconde remise
échoue sans créer d'événement financier.

### Caisse et monnaie

Une session ouverte porte fonds initiaux, terminal et caissier. Le paiement et
les `CashMovement` sont atomiques ; une vente de 9 700 CDF réglée par 5 USD au
taux snapshot 2 500 crée une entrée 5 USD et une sortie 2 800 CDF. La clôture
collecte d'abord le physique à l'aveugle, puis calcule l'écart. Une clôture
validée est immuable ; toute correction est une régularisation liée.

### Idempotence et synchronisation

Une table d'idempotence est indexée de manière unique par portée, clé et
empreinte de requête. Même clé + même payload retourne la réponse enregistrée ;
même clé + payload différent est refusé. Les opérations offline portent UUID,
appareil, agent, horodatage, type, payload, clé, état et conflit éventuel. Elles
ne sont jamais supprimées silencieusement.

## 8. Contraintes et transactions PostgreSQL

- Unicité : QR token actif/historique, numéros de commande et de vente,
  références externes de paiement dans leur portée, opérations sync et clés
  idempotentes.
- Snapshots non mutables : prix, taux, plan/menu, taxe éventuelle et libellés
  d'articles sont copiés sur l'opération ; les modifications futures ne peuvent
  réécrire l'historique.
- États : transitions contrôlées par service et contraintes/checks quand elles
  sont exprimables ; chaque changement significatif écrit `OrderStatusHistory`.
- Toutes les valeurs monétaires sont `numeric`, jamais `float`; devise ISO
  explicitée ; timestamps UTC et `businessDate` locale explicite.
- Les opérations paiement, droit, service, création commande/tickets,
  remboursement, clôture, réception et synchronisation utilisent une
  transaction Prisma interactive avec isolation adaptée. Les chemins à forte
  concurrence utilisent SQL verrouillé exécuté dans celle-ci.

## 9. Offline et continuité

IndexedDB conserve uniquement le cache nécessaire, la session non sensible et
l'outbox chiffrable selon la politique terminal ; jamais mots de passe, secrets
ou autorisations capables de contourner le serveur. Le service worker ne met en
cache que des ressources versionnées et des lectures explicitement sûres.

Le serveur edge local est un déploiement distinct avec base locale, appareil
identifié et journal de synchronisation. Les conflits ne sont ni écrasés ni
masqués : ils deviennent `CONFLICT`/`REJECTED`, restent consultables et exigent
une résolution autorisée. Perte LAN : passage au poste de secours désigné ;
panne électrique : procédure manuelle numérotée documentée.

## 10. Déploiement, observabilité, qualité

- Environnements distincts development/test/staging/production ; `.env.example`
  uniquement. PostgreSQL reste sur réseau interne Docker, inaccessible Internet.
- Images distinctes web/API, Compose dev et production, Nginx TLS/redirect,
  proxy headers, limites upload et healthchecks. `/health`, `/health/ready` et
  liveness sont fournis par l'API.
- JSON logs structurés sans PII ni secrets, `requestId`/correlation ID ; points
  d'extension Prometheus, Sentry et OpenTelemetry.
- GitHub Actions : install, lint, typecheck, tests unitaires/intégration, build,
  `prisma validate` et vérification migrations. Playwright couvre le parcours
  POS-cuisine et les R01–R14 cités.
- Backups PostgreSQL quotidiens chiffrables, hors hôte principal, rotation,
  vérification et restauration testée. La procédure sera documentée dans
  `BACKUP.md` et `RESTORE.md` pendant l'étape infrastructure.

## 11. Risques et validations métier requises

| Sujet | Décision requise avant activation production |
| --- | --- |
| Flex | prix, services, quotas, période et règles de droit |
| Calendrier | horaires, jours d'ouverture et définition des services |
| Abonnements | acompte, solde minimum, suspension, annulation, report |
| Livraison | zones, frais, SLA, échec et code de remise |
| Finance | règles de remboursement, approbations, comptes, arrondi USD/CDF |
| Paiements externes | procédure de confirmation manuelle et unicité de référence |
| Confidentialité | personnes autorisées allergies/photos, rétention et export |
| Offline | matériel edge, poste de secours, procédures LAN/électricité |
| Menus | disponibilité, variantes, substitutions et comportement rupture |

Les tarifs initiaux (140/110/60/40 USD et Flex sur devis) sont des données de
seed DEV configurables, jamais des constantes frontend. Les éléments ci-dessus
sont marqués **À VALIDER** dans Settings tant que JAMI FOOD ne les a pas validés.

## 12. Plan d'implémentation contrôlé

1. Initialiser monorepo/configuration/docs et CI minimale.
2. Implémenter Prisma/migrations/seed DEV puis auth/RBAC/audit.
3. Clients + QR, puis plans/prix/abonnements/droits et leurs tests concurrence.
4. POS, paiements/multidevise, commande/tickets, cuisine et livraison.
5. Caisse/dépenses/clôture, rapports, PWA/offline-edge, puis modules phase 2.
6. Vérifier à chaque lot migrations, typecheck, lint et tests avant le suivant.

Le schéma conceptuel et les détails de contraintes sont dans
[`DATA_MODEL.md`](DATA_MODEL.md), et l'état de couverture initial dans
[`COMPLIANCE_MATRIX.md`](COMPLIANCE_MATRIX.md).

## Revue du 25 septembre 2026 et ordre de réalisation

Références : cahier des charges Word fourni et mission technique complémentaire
(99 sections). L'affiche fixe la direction graphique (crème, bordeaux, rouge,
doré), sans remplacer les règles financières du cahier.

Constat du code initial : schéma Prisma compact invalide, aucune migration,
authentification sans session, aucun garde RBAC, paiements sans ledger ni contrôle
du montant, interfaces statiques. Les documents décrivent une cible et ne prouvent
pas sa réalisation. La mise en production est donc exclue à ce stade.

Ordre des lots : (1) schéma exécutable, migration, session et permissions ;
(2) clients et QR, abonnements et droits datés ; (3) commande, paiement et ledger,
reçus et cuisine ; (4) clôture, livraison, rapports ; (5) continuité et reprise ;
(6) phase 2 isolée ; (7) recette R01–R16, sécurité et déploiement.
Chaque lot doit être vérifié avant toute déclaration de conformité.

Décisions métier ouvertes : calendriers et dimanche, report et suspension,
acompte et échéance, Flex, tarifs hors grille, livraison, taux et arrondi,
remboursements, reconnaissance du CA, conservation des données. Les règles de
production restent inactives tant qu'elles ne sont pas validées. Les jeux DEMO
utilisent des paramètres explicitement fictifs, séparés des environnements réels.

Décision transactionnelle : PostgreSQL demeure l'unique autorité de validation.
Les mutations verrouillent d'abord leur clé d'idempotence puis les agrégats métier
concernés. Le résultat et l'audit sont enregistrés dans la même transaction.
Le scan ne consomme rien, et les transitions de service ne créent pas de recettes.
La cuisine reçoit des projections minimales sans données financières du client.

Le lancement local peut employer un stockage temporaire de dépendances en raison
du disque presque plein. Ce stockage ne constitue jamais une stratégie de
persistance ou de sauvegarde de production.
