# Security model

Each installation is one private notes workspace with one configured Supabase Auth UUID. It is not a multi-user SaaS, an end-to-end encrypted vault, or a folder-sharing system.

- RLS guards all exposed note tables and private image storage. The owner is selected by an administrator in `notes_private.settings`; there is no public claim endpoint.
- Browser and Vercel code use only the publishable key. Supabase Edge Functions use server-side credentials for image storage and embeddings. These functions authorize each operation themselves because the MCP path cannot require a Supabase user JWT.
- Agent keys are random credentials stored as SHA-256 hashes. Read/Inbox/Edit scopes are checked in Postgres, including image write preflight. All scopes can read every note and history. Inbox scope can edit all Inbox notes.
- Internal privileged SQL functions have fixed search paths and revoked execution for web roles. The public API authenticates owner sessions or notes keys; a plain privileged SQL-agent shortcut is not included.
- Scheduler credentials are private, checked by the embedding worker, and shared between Edge Function secrets and the private database configuration. Authenticated cleanup only deletes images marked due by the database.
- Agent image links expire after one hour. Revoking a key stops new API calls, but previously issued image links and files already copied to an agent may persist. External AI providers receive the text/images their tools retrieve.
- URL image downloading is disabled unless an administrator configures trusted exact HTTPS hosts. Redirect destinations must also be allowed. Prefer base64 uploads. Do not allow internal services or attacker-controlled hosts.
- MCP checks Origin headers and does not use cookies for agent access. Prefer Authorization headers to key URLs, which can enter infrastructure logs. Third-party client origins require explicit configuration.
- Drafts/cached notes are stored on the device without application-level encryption. Signing out does not erase every browser cache. Clear site data on shared devices.

Read-only access is still sensitive. Agent mistakes, prompt injection in note contents, hosting-account compromise, or a stolen key can expose data. Select the narrowest useful permissions, keep backups, and review agent changes. Do not share real notes or credentials in public bug reports.

## Report a vulnerability

Use this repository's GitHub **Security → Report a vulnerability** (private vulnerability reporting) if enabled. Otherwise open an issue requesting a private reporting channel without including exploit payloads, credentials, or private data. Do not post a live key in an issue.

The repository is community software under the MIT license, without a security or availability guarantee. Do not represent automated checks as an independent security audit.
