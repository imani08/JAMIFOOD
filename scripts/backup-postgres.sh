#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR is required}"
mkdir -p "$BACKUP_DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/jami-food-$stamp.dump"
pg_dump --format=custom --no-owner --dbname="$DATABASE_URL" --file="$target"
test -s "$target"
find "$BACKUP_DIR" -name 'jami-food-*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-30}" -delete
