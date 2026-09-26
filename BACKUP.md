# Sauvegarde PostgreSQL

Exécuter quotidiennement `scripts/backup-postgres.sh` depuis un hôte sécurisé,
avec `DATABASE_URL`, `BACKUP_DIR` hors du serveur principal, et une politique de
rétention. Chiffrer les dumps au repos selon la politique ULC et contrôler la
taille/sortie du script. Une sauvegarde n'est considérée valide qu'après un test
de restauration périodique sur une instance isolée.
