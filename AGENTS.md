# Working in this repository

CommonNotes is a single-owner notes app deployed into each user's own Supabase and Vercel accounts.

- If asked to **install**, read and execute `INSTALL.md`. Do not create cloud resources just because this file was opened. Preserve unrelated projects and credentials.
- If asked to **develop**, read `CONTRIBUTING.md`. Use a disposable database for tests. Never run `supabase db reset`, fixtures, or database tests on a live notes project.
- Keep the owner check based on the configured Auth UUID. No first-visitor ownership, email-only authorization, or `user_metadata` authorization.
- RLS is required on exposed tables. Internal `SECURITY DEFINER` functions must have fixed search paths and revoked public execution. Public entry points must authenticate owner sessions or hashed agent keys.
- Retain read, Inbox, and edit permission boundaries, image checks, version conflicts, and the agent audit log.
- Public `VITE_*` variables contain only the project URL, publishable key, and UI flags. Never commit secrets, personal notes, `.setup/`, `.env.local`, `.vercel/`, or production database dumps.
- Use `npm ci`, `npm test`, `npm run test:edge` (requires Deno), and `npm run build`. Run `npm run test:db` against disposable Postgres with pgvector for SQL changes. See `CONTRIBUTING.md` for integration checks.
- Demo mode (`VITE_DEMO=true`, `src/demo/`) swaps the Supabase client for an in-memory one. If you add a query, table, RPC or `notes_api` action the app uses, add it to `src/demo/client.js` and `src/demo/seed.js` too.
- Do not promise universal client support, unlimited free hosting, or completed cloud verification without evidence.
