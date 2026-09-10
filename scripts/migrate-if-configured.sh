#!/bin/sh
# Runs the Drizzle schema push only if DATABASE_URL is already set (e.g. a
# Postgres was connected in Vercel). Never fails the build when it isn't --
# that just means the database hasn't been connected yet.
if [ -n "$DATABASE_URL" ]; then
  pnpm --filter @workspace/db run push
else
  echo "DATABASE_URL is not set yet -- skipping database migration. Connect a Postgres database in Vercel (Storage tab) and redeploy."
fi
