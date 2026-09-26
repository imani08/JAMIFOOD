# Restauration PostgreSQL

1. Mettre l'API en maintenance et conserver la base défaillante sans l'écraser.
2. Créer une base PostgreSQL vide sur un environnement isolé.
3. Lancer `pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" backup.dump`.
4. Exécuter les contrôles d'intégrité, une connexion applicative en lecture et
   les tests de parcours critique avant toute remise en service.
5. Documenter l'incident et l'auditer ; ne jamais restaurer directement par une
   commande non vérifiée sur la production.
