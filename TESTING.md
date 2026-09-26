# Tests

Les tests sont organisés par niveaux : règles pures (unit), services avec
PostgreSQL jetable (intégration) et Playwright (E2E). À exécuter :

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

La suite d'intégration doit créer une base dédiée, jamais utiliser la base de
production. Les cas prioritaires à automatiser avant toute mise en production :

- R03 : deux transactions tentent de consommer le dernier `MealRight`, une seule
  réussit ; répétition avec la même clé retourne le premier résultat.
- POS → paiement confirmé → commande CMD → bon cuisine → PREPARING → READY →
  SERVED ; une seconde remise est refusée.
- R06 livraison : une seule confirmation consomme le droit réservé.
- R07 : 9 700 CDF payé 5 USD au taux 2 500 crée 5 USD entrants et 2 800 CDF de
  rendu, sans deuxième mouvement.
- R08 : paiement Mobile Money `PENDING`, puis confirmation répétée, sans double
  encaissement.
- R09 : ancien prix/taux conservé après une nouvelle version.
- R10 clôture et R11 refus RBAC.
- R12 : outbox Offline répétée, pertes LAN/redémarrage et conflits visibles.
