# Sécurité

Les secrets restent hors Git et proviennent de variables d'environnement. Les
pages web ne constituent pas une autorisation : toute mutation doit recevoir un
utilisateur authentifié et une permission vérifiée côté NestJS. Les données
alimentaires, photos et justificatifs sont privées ; QR et tickets emploient des
jetons opaques. Les journaux ne contiennent ni mot de passe, ni PIN, ni données
complètes de carte/Mobile Money.

Avant production : configurer secrets aléatoires, TLS, `COOKIE_SECURE=true`,
stockage objet privé, CSP adaptée, rate limiting distribué, MFA des comptes
privilégiés et un rôle PostgreSQL applicatif sans DELETE/UPDATE sur `AuditLog`.
