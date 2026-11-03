# Contributing

Use a fresh checkout, Node 22.14+ (24 LTS recommended), npm, and Deno for Edge Function helper tests. Do not use your live notes database as a test fixture.

```sh
npm ci
npm test
npm run test:edge
npm run check:edge
npm run build
npm audit
```

`api/mcp-transport.test.js` uses the official MCP client SDK against the actual HTTP handler, with a mocked Supabase backend. It covers initialization, discovery, a note read, revocation, Origin checks, invalid JSON, and notifications. It is not a hosted Vercel/Supabase test.

## Database tests

Use a disposable Postgres 15+ server with pgvector. `npm run test:db` drops and recreates **notes_test** on that server. It creates Supabase role/Auth/Storage stand-ins, applies all migrations, and checks RLS, explicit ownership, agent scopes, revocation, edits, versions, folders, search and image tickets.

For example, run a disposable local container (choose a free local port and unique container name):

```sh
docker run --detach --name notes-test --env POSTGRES_HOST_AUTH_METHOD=trust \
  --publish 127.0.0.1:55439:5432 pgvector/pgvector:pg17
PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres npm run test:db
```

This requires `psql` on your PATH. Wait until Postgres is ready before testing. Delete only this disposable container when done. The trust-auth example binds to loopback and must never be used as a production database.

The assertion-based `security_test.sql` checks RLS and function exposure, rejects other UUIDs even when their email matches the owner's, tests private Storage, and proves an unconfigured workspace grants no ownership. The behavior suite also exercises the API. The shim does not reproduce every Supabase platform behavior; use the installation acceptance checks against a separate real project before calling a hosted installation verified.

For schema changes, create migrations with the Supabase CLI, test them on a disposable database, run the provider's advisors, and preserve explicit grants with RLS. Do not add broad default grants or commit a real owner configuration.

## Local UI

After linking a dedicated development project and configuring `.env.local`, run `npm run dev` for the Vite UI or `vercel dev` for the full serverless API. Preview builds with `npm run preview`. Never use production notes in committed screenshots.

## Pull requests

Explain the user-visible behavior and relevant validation. Keep credentials and private data out of issues and PRs. Add meaningful tests for permission, storage, sync, and transport changes. Keep installation instructions and the tool reference in sync with implementation. The repository uses exact dependency versions and a committed lockfile; update them together.
