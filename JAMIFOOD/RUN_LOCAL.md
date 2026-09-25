# Lancement local JAMI FOOD

Cette version utilise Next.js, NestJS et PostgreSQL. Elle est destinée à la
recette locale avec les comptes DEMO. Elle ne constitue pas une validation de
mise en production.

Depuis la racine du projet, après installation des dépendances :

```bash
bash scripts/start-local.sh
```

L’interface est disponible sur http://localhost:3000 et l’API sur
http://localhost:3001/api/v1. Les journaux sont dans `.local/logs/`.
La base de démonstration est conservée dans `.local/pgdata/`, exclue de Git.
Les comptes sont `direction.demo`, `caissier.demo` et `cuisine.demo` ; leur
mot de passe initial provient de `DEMO_PASSWORD` dans le fichier local `.env`.
Le seed refuse la production et ne remplace pas un mot de passe existant.

Les fonctions présentes comprennent la connexion, les permissions backend,
le catalogue, les commandes, les paiements manuels, le parcours cuisine,
les fiches clients, les souscriptions et droits datés, les opérations de stock,
les achats/réceptions et les clôtures avec consultation, impression et CSV.

Les accès depuis l’extérieur nécessitent un déploiement HTTPS durable et les
contrôles de recette listés dans COMPLIANCE_MATRIX.md. Le serveur local n’est
pas un hébergement en ligne. L’intégration à un TPE bancaire n’est pas activée :
les références de paiement externes sont saisies puis vérifiées manuellement.
