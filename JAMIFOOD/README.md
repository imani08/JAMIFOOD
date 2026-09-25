# JAMI FOOD

Plateforme de gestion opérationnelle du restaurant ULC. Consultez
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`DATA_MODEL.md`](DATA_MODEL.md) et
[`COMPLIANCE_MATRIX.md`](COMPLIANCE_MATRIX.md) avant une mise en production.

## Démarrage développement

1. Copier `.env.example` vers `.env` et remplacer chaque secret.
2. `docker compose up -d postgres`
3. `pnpm install && pnpm db:generate && pnpm db:migrate`
4. Pour les seules données de démonstration : `SEED_DEMO=true pnpm db:seed`.
5. `pnpm dev`

Ne jamais utiliser le seed DEMO en production. PostgreSQL est volontairement
lié à `127.0.0.1` en développement et n'est pas exposé dans la surcharge
production.
