# Install Commonplace

This file is both a human guide and an execution runbook for a coding agent. The goal is a working private instance in **the installer's own accounts**, verified from sign-in through an agent-created note.

## Instructions for the coding agent

1. Read this file and `AGENTS.md`. Inspect available provider connectors and authenticated CLIs. Use supported tools and current official documentation; CLI flags can change, so check `--help` first.
2. Use a **new dedicated Supabase project and new Vercel project**. Never reuse, migrate, reset, or change an existing app or database without an explicit request. This is a fresh-install schema, not an in-place upgrade of the original personal app.
3. Target Supabase Free and Vercel Hobby for eligible personal use. Do not activate a trial, add billing, buy a domain, or upgrade a plan. Stop at an actual billing requirement and explain it.
4. Perform every supported step; request human help only for login, account/organization selection when ambiguous, the owner's password/identity, or unavailable provider capabilities. Do not ask users to paste secrets into chat. Use provider login flows and local ignored credential files.
5. Keep a private checkpoint of project identifiers and completed steps outside committed files. Resume from evidence; do not provision duplicates. Never claim a step passed if it was skipped or blocked.
6. Keep secret/service-role credentials out of Vercel, `VITE_*` variables, Git, screenshots, and logs. Agent keys and `.setup/` files are private. If a command fails, inspect the cause before retrying.

## 1. Accounts and source

Have a GitHub account, a Supabase account with capacity for a Free project, and a Vercel Hobby account for personal non-commercial use. Login and any anti-abuse/account verification must be completed by the account holder. Node 22.14+ and npm are required; Node 24 LTS is recommended.

Use GitHub's **Use this template** button (or fork the repo) to create your own copy, then clone it. An agent can do this using GitHub tools if authorized. A private copy is fine; application source visibility never controls access to the notes.

```sh
git clone https://github.com/YOUR-USERNAME/notes-with-mcp.git
cd notes-with-mcp
npm ci
npm test
npm run build
```

Use authenticated provider MCP tools if available. Otherwise install/login to the official [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and [Vercel CLI](https://vercel.com/docs/cli). Never reuse credentials from the upstream author.

## 2. Create and migrate your Supabase project

Create a **new Free project** in your own Supabase organization. Save its database password in your password manager. Record the project reference, project URL, and **publishable** API key from the project Connect/API settings.

Link the local copy to that exact project, then apply its migration:

```sh
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push --dry-run
supabase db push
```

The repository includes one consolidated migration in `supabase/migrations/`. It creates the notes tables, RLS policies, private installation settings, and the private image bucket. It has no author-specific URLs or users. A provider connector can execute the migration instead; record which path was used and do not then reapply it using unrelated migration history.

The app intentionally grants nobody access until an administrator configures the owner. There is no public sign-up or “first visitor becomes owner” flow.

## 3. Create the owner and configure ownership

In Supabase **Authentication → Users → Add user → Create new user**, create your own email/password user and confirm it using the dashboard's auto-confirm option. Choose a strong password privately. An agent with authorized Supabase Admin Auth API access may create this user instead; do not insert into `auth.users` with hand-written SQL.

Copy the user's **UUID** from the Users screen. Ownership uses this UUID, not an email, OAuth profile, or editable user metadata. Disable **Allow new users to sign up** in Authentication settings after creating the owner. Public registrations are unnecessary even though RLS also blocks outsiders.

Generate the private configuration files:

```sh
npm run setup -- --project-url https://YOUR_PROJECT_REF.supabase.co --owner-id YOUR_AUTH_USER_UUID
```

This creates `.setup/configure.sql` and `.setup/functions.env` with a matching random scheduler secret. Both are ignored by Git and are not printed. The command refuses to overwrite files; reuse existing files on a resumed install. To rotate the scheduler secret later, archive the old files privately, generate a replacement, and apply both files again.

Execute **`.setup/configure.sql` in your project's SQL Editor**, or through an authorized database tool without exposing its contents in logs. This selects the owner and configures your project URL. Do not run the test fixtures on a live project.

Check in SQL Editor (should return `true` without exposing any secrets):

```sql
select exists (select 1 from notes_private.settings) as installation_configured;
```

## 4. Deploy Edge Functions

Set the scheduler secret from the private file and deploy the three functions:

```sh
supabase secrets set --env-file .setup/functions.env
supabase functions deploy notes-images --no-verify-jwt
supabase functions deploy notes-search --no-verify-jwt
supabase functions deploy notes-embed --no-verify-jwt
```

`--no-verify-jwt` is intentional: agent calls use notes keys rather than Supabase JWTs. Each operation performs its own authorization. The embedding worker requires the private scheduler secret; images require an owner session, a permitted agent key, or a short-lived image ticket. Supabase provides server credentials inside its Edge Functions; do not copy them to the frontend or Vercel.

Run **`supabase/schedules.sql`** in SQL Editor after the functions are deployed. It uses the private configuration, so there are no URLs/secrets to substitute. It schedules embeddings only while notes need indexing, hourly image cleanup only when images are due, and a nightly orphan-upload sweep. Running it again replaces only these three named jobs.

Optional: to allow agents to download images from URLs, set `NOTES_IMAGE_URL_HOSTS` as a comma-separated list of **trusted exact HTTPS hostnames**, e.g. `images.unsplash.com`. Redirects must remain on allowed hosts. Base64 image uploads work without this setting and are the default. Do not allow internal or attacker-controlled hosts.

If semantic-search deployment is unavailable, keyword search still works, but record that semantic search has not been enabled. Do not describe the installation as fully verified until the required feature checks pass.

## 5. Deploy the web app and MCP endpoint on Vercel

Import your GitHub copy as a **new** Vercel project, choosing **Vite**, the repository root, build command `npm run build`, and output directory `dist`. The `/api/mcp.js` file is deployed as a Vercel Function automatically.

Set these environment variables on the project:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Your project URL, without a trailing slash |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Your publishable key (`sb_publishable_…`) |
| `VITE_ENABLE_GOOGLE_AUTH` | `false` unless you complete the optional Google setup |

These are public client configuration. **Never set a Supabase secret or service-role key in `VITE_*` variables.** The MCP function reads the same public values at runtime. If using CLI tooling, link the new Vercel project before adding environment values, then deploy. Use the official CLI's current commands discovered with `--help`.

Deploy and record the production HTTPS URL. Add that exact URL as the **Site URL** and an allowed redirect URL in Supabase Authentication → URL Configuration. Rebuild/redeploy after any `VITE_*` change.

Ensure the production `/api/mcp` endpoint is reachable by your agent. If Deployment Protection intercepts it, adjust protection on this new project as appropriate; do not disable authentication in the app. A plain browser GET to `/api/mcp` should return **405**, not a Vercel login page. A POST without a notes key must return **401**.

## 6. Verify the complete installation

The installer should complete and record each check, asking the user to perform a step only when necessary:

- Sign in with the configured owner's email/password. Create a folder and note, edit it, reload, and confirm persistence. Sign out and back in.
- Paste/upload a test image, reload, and confirm it is visible. Remove it and confirm **Trash → Images** tracks it. Do not delete real data while testing.
- Create an **Add to Inbox** key in **AI access**. Connect an agent using [docs/agents.md](docs/agents.md). Have it list tools, create a uniquely named test Inbox note, read it, and append text. Confirm the note and agent activity in the web app.
- Confirm that key cannot create a folder or edit a filed note. Make a **Read only** key and confirm a write is refused. Revoke a disposable key and confirm it immediately stops working.
- Change a test note twice and inspect **Version history**. Restore a test version. Check Trash/restore using test notes.
- Search a keyword. After indexing has run, check that `content_hash = embedded_hash` for the test note and perform a meaning-based query. Check Edge Function logs if indexing fails.
- Run `supabase db advisors --linked --type security` or the provider's security advisor. Review findings; do not silence them by granting broad access. Confirm `note-images` is a private bucket.
- Run `npm test` and `npm run build`. On a phone, optionally add the app to the home screen and try a brief offline edit, reconnect, and check sync.

Final handoff: provide the app URL, Supabase project reference, Vercel project name, enabled features, checks passed, any remaining user steps, and backup instructions. **Do not include passwords, notes keys, scheduler secrets, or private configuration contents.** Remove test notes only after verifying their exact IDs. Keep `.setup/` private or delete it once the credentials are safely stored.

## Optional Google sign-in

Configure the [Google provider](https://supabase.com/docs/guides/auth/social-login/auth-google) in Supabase and Google's console, including the Supabase callback and your app's allowed redirects. Enable `VITE_ENABLE_GOOGLE_AUTH=true` and rebuild. Ensure the Google identity is linked to the same owner UUID; do not enable open sign-up just to work around an identity mismatch. Email/password remains available.

## Troubleshooting

- **“This account does not have access”:** verify its Auth UUID matches `notes_private.settings.owner_user_id`. No ownership changes happen on sign-in.
- **“Finish installation”:** check the two required Vercel variables and redeploy. `VITE_*` values are baked into the build.
- **Tables/RPC not found:** confirm migration success, `public` is exposed in Data API settings, and grants exist. New Supabase projects require explicit grants; the migration includes them. Do not grant all tables to anonymous users.
- **MCP 401:** use a fresh, unrevoked notes key; the Supabase publishable key is not an agent key.
- **MCP 403 with an Origin header:** set `MCP_ALLOWED_ORIGINS` on Vercel to the exact trusted client origin(s), comma-separated. Requests without Origin and requests from the app's own HTTPS origin are supported by default. Never use a wildcard.
- **MCP cannot connect:** ensure the client supports Streamable HTTP with a bearer key or key URL. This app does not implement OAuth discovery or legacy SSE. Consult the client's current plan restrictions.
- **Semantic search unavailable:** check deployed functions, scheduler secret consistency, `cron.job`, and Edge Function logs. Keyword search remains available.
- **Images via URL refused:** send base64, or configure the trusted host allowlist; see step 4.
- **Forgot password:** update the owner's password using Supabase's administrative user controls. Email recovery requires configuring your own delivery flow; the app has no self-service recovery screen.
- **Paused project/quota limit:** restore the project in Supabase or wait for quotas as allowed by your plan. Back up regularly; do not upgrade without the account holder's decision.
