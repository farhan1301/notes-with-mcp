# Release verification

Initial public release checked November 3, 2026.

- 30 Node tests passed: Markdown/formatting/folders, tool definitions, MCP image responses, the real HTTP transport with the official MCP SDK, private setup-file generation, and portable text/image export.
- Four Edge Function image-download tests passed: host restrictions, redirect restrictions, streamed size limits, and byte preservation. All three Edge Function entry points passed Deno type checking.
- Production Vite build passed. `npm audit` reported no known vulnerabilities in the locked dependency tree at verification time.
- Disposable Postgres 17 with pgvector: migrations, owner/RLS/Storage checks, API behavior, permission levels, revocation, conflicts, history, search, and image tickets passed. Supabase CLI's SQL security advisor reported no issues at warn/error level on this test database.
- Local end-to-end exercise: official MCP SDK → HTTP handler → PostgREST 13 → Postgres. An Inbox key created, appended to, and read back a persisted note; folder creation was refused.
- Desktop/mobile UI inspected in Chrome using mocked Supabase responses and fictional notes. Screenshots show sample data, not a hosted production account.

These checks are not an independent security audit or proof of a fresh hosted deployment. Vercel routing/protection, Supabase Auth, hosted Edge Function inference, cron execution, and the selected end-user clients must still pass the acceptance checks in `INSTALL.md` on each installation. No existing personal Supabase or Vercel project was used for these tests.
