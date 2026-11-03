#!/usr/bin/env bash
# Requires a disposable Postgres 15+ server with pgvector; never target production.
# Recreates only notes_test. PGHOST/PGPORT/PGUSER are standard libpq settings.
set -euo pipefail
cd "$(dirname "$0")/../.."
psql -X -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists notes_test" -c "create database notes_test"
psql -X -v ON_ERROR_STOP=1 -d notes_test -f supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do
  psql -X -v ON_ERROR_STOP=1 -d notes_test -f "$f"
done
psql -X -v ON_ERROR_STOP=1 -d notes_test -f supabase/tests/configure.sql
psql -X -v ON_ERROR_STOP=1 -d notes_test -f supabase/tests/security_test.sql
psql -X -v ON_ERROR_STOP=1 -d notes_test -f supabase/tests/notes_api_test.sql
