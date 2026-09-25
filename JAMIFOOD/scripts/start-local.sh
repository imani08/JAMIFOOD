#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -x /home/imani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ]]; then
  export PATH="/home/imani/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/home/imani/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"
fi
mkdir -p .local/logs
docker start jami-food-dev-db >/dev/null
packages/database/node_modules/.bin/prisma generate --schema packages/database/prisma/schema.prisma
packages/database/node_modules/.bin/prisma migrate deploy --schema packages/database/prisma/schema.prisma
node --env-file=.env --import ./packages/database/node_modules/tsx/dist/loader.mjs packages/database/prisma/seed.ts
for package in shared validation database; do
  "packages/$package/node_modules/.bin/tsc" -p "packages/$package/tsconfig.build.json" --incremental false
done
apps/api/node_modules/.bin/tsc -p apps/api/tsconfig.json --incremental false
if ! curl -fsS --max-time 2 http://127.0.0.1:3001/api/v1/health >/dev/null; then
  nohup node --max-old-space-size=256 --env-file=.env apps/api/dist/main.js >.local/logs/api.log 2>&1 &
  echo "$!" >.local/api.pid
fi
if ! curl -fsS --max-time 2 http://127.0.0.1:3000/login >/dev/null; then
  (cd apps/web && nohup env NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=640 node_modules/.bin/next dev --hostname 127.0.0.1 >../../.local/logs/web.log 2>&1 &)
fi
printf 'Application : http://localhost:3000\nJournaux : .local/logs/\n'
