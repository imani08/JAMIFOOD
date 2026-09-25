# Matrice de conformité initiale

Statut au stade analyse : `PARTIAL` signifie conception documentée mais code et
test absents ; `OPTIONAL`/`À VALIDER` ne sont pas activés par défaut. Aucun item
n'est déclaré `IMPLEMENTED` avant preuve dans le code et les tests.

| Exigence | Module | Implémentation / preuve actuelle | Test | Statut |
| --- | --- | --- | --- | --- |
| Monorepo pnpm Next/Nest/Prisma | Foundation | Architecture cible définie | À créer | PARTIAL |
| TypeScript strict, Tailwind, shadcn, Query/Table, RHF/Zod | Web | Stack spécifiée | À créer | PARTIAL |
| PostgreSQL, Prisma, migrations, contraintes | Database | Modèle conceptuel dans DATA_MODEL | À créer | PARTIAL |
| Auth sécurisée, sessions, anti-brute-force | Auth | Design sécurité défini | Unit + intégration | PARTIAL |
| MFA comptes privilégiés | Auth | Capacité configurable, décision nécessaire | À valider | OPTIONAL |
| RBAC backend à permissions fines | RBAC | Rôles et modèles définis | Intégration R11 | PARTIAL |
| Audit append-only | Audit | AuditLog + règle de privilèges DB conçus | Intégration | PARTIAL |
| Clients, archive, doublons, fusion | Clients | Modèle et règle conservation conçus | Unit + E2E | PARTIAL |
| Données allergies restreintes | Clients | Chiffrement/permission prévus | Autorisation | PARTIAL |
| QR opaque, révocation, remplacement | QR | Hash token + historique définis | Intégration | PARTIAL |
| Scan QR sans consommation automatique | Meals | Workflow séparé documenté | E2E R01/R02 | PARTIAL |
| Plans/prix versionnés | Pricing | SubscriptionPlanVersion/PriceVersion | Intégration R09 | PARTIAL |
| Formules de seed configurables | Seed | Règle DEV explicitée | Seed test | PARTIAL |
| Abonnements, dates Africa/Kinshasa | Subscriptions | Règle D+29 documentée | Unit dates | PARTIAL |
| Droits AVAILABLE/RESERVED/CONSUMED/CANCELLED | Meals | MealRight et services proposés | Unit quotas | PARTIAL |
| Dernier droit : concurrence sûre | Meals | verrou + unique constraint conçus | Intégration concurrente R03 | PARTIAL |
| Idempotence mutations sensibles | Platform | IdempotencyRecord défini | Intégration répétition | PARTIAL |
| POS tactile et catalogue/panier | POS | Architecture UI spécifiée | Playwright | PARTIAL |
| Flux paiement → commande → tickets → cuisine | Orders | Workflow et modèles définis | E2E complet section 62 | PARTIAL |
| Numéro CMD stable unique | Orders | `Order.number @unique` conçu | Intégration | PARTIAL |
| Reçu financier distinct du bon cuisine | Tickets | Modèles/documents distincts | E2E | PARTIAL |
| Transitions cuisine et remise unique | Kitchen | machine d'états définie | E2E seconde remise refusée | PARTIAL |
| Abonné sans seconde recette | Meals / Orders | MealConsumption lié à Order | Intégration | PARTIAL |
| Annulation/régularisation auditée | Orders / Payments | principe append-only défini | Intégration | PARTIAL |
| Livraison mobile et confidentialité | Delivery | Modèle, champs minimisés | E2E R06 | PARTIAL |
| Menus/MenuVersion historiques | Menus | modèles définis | Intégration | PARTIAL |
| USD/CDF, snapshot taux, rendu | Payments | modèle Decimal + movements | R07 | PARTIAL |
| Mobile Money pending ≠ encaissé | Payments | statuts définis | R08 | PARTIAL |
| Sessions caisse et comptage aveugle | Cash | modèles et règle définis | R10 | PARTIAL |
| Dépenses / sorties / clôture immuable | Cash | ledger/régularisation conçus | R10/R11 | PARTIAL |
| Rapports distincts CA/encaissement/trésorerie | Reports | contrat analytique défini | Intégration | PARTIAL |
| PWA, cache, indicateur offline | Web / Offline | stratégie décrite | Playwright offline | PARTIAL |
| Edge LAN multi-POS | Offline | architecture dédiée requise | R12 infra | PARTIAL |
| Poste de secours et procédure manuelle | Offline | stratégie définie | Exercice opératoire | PARTIAL |
| Sync push/pull, outbox, conflits visibles | Sync | Device/SyncOperation conçus | R12 | PARTIAL |
| Phase 2 stock/recettes séparée | Inventory | périmètre isolé dans DATA_MODEL | R15/R16 | PARTIAL |
| Sécurité OWASP, uploads privés | Security | contrôles prévus | Security tests | PARTIAL |
| Swagger, API stable, erreurs françaises | API | contrat architectural défini | Contract tests | PARTIAL |
| Pagination, filtre, recherche | API | exigence de design | Integration / E2E | PARTIAL |
| Docker, Nginx HTTPS, health checks | Infrastructure | topologie définie | Compose smoke test | PARTIAL |
| CI/CD qualité et migrations | CI | pipeline cible définie | GitHub Actions | PARTIAL |
| Backups/restore testés | Operations | stratégie définie | restauration documentée | PARTIAL |
| Documentation de production | Documentation | 3 documents d'analyse présents | revue documentaire | PARTIAL |
| Portail étudiant | Extension | extension seulement | À décider | OPTIONAL |
| Wallet ledger | Extension | extension seulement, pas balance simple | À décider | OPTIONAL |
| Notifications email/SMS/WhatsApp | Extension | abstraction seulement | À décider | OPTIONAL |

## Décisions bloquantes avant une déclaration « IMPLEMENTED »

Les paramètres Flex, calendrier et services, acomptes/solde/suspension/report,
remboursements et arrondis, zones/frais de livraison, procédure de confirmation
Mobile Money, politique de confidentialité/rétention et matériel edge sont **À
VALIDER**. Leur existence dans le modèle ne vaut pas activation métier.
