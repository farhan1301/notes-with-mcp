# Notes with MCP

**Your notes. Your data. Connected to your AI agents.**

An Apple Notes–inspired notes app with a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server. Write on your phone or computer. Let an agent find an idea, clean up dictation, file your Inbox, or add a screenshot—with the access you choose.

Deploy a private copy in **your own Vercel and Supabase accounts**. Your notes stay in your database; this repository contains the application, not a shared notes service.

![Notes with MCP showing folders, notes, and the editor](docs/screenshot.png)

*Example workspace with fictional notes.*

## Install with your coding agent

Give Codex, Claude Code, or another coding agent this prompt:

> Install https://github.com/farhan1301/notes-with-mcp for me. Read INSTALL.md and follow it to set up a private, single-owner instance in my own Supabase and Vercel accounts using the free personal-use tiers. Handle the setup and verification you can, and guide me through account sign-in or steps that need my input. Do not purchase anything or modify an existing project.

**[Installation guide →](INSTALL.md)** · **[Connect your agents →](docs/agents.md)** · **[Back up your data →](docs/data.md)**

You will need accounts with both providers. Account login, choosing the owner, and supplying credentials may need your participation. No paid AI API key is required by this app. Your agent's own subscription or usage is separate.

## A notes app you can use every day

- **Familiar layout:** resizable folders, notes, and editor columns; list or gallery; pins; date grouping; light, dark, or system appearance.
- **Write naturally:** plain text or Markdown, formatting controls, headings, lists, checklists, tables, and autosave. Drafts stay on the device during a connection interruption and sync when you reconnect.
- **Keep images with your notes:** paste, drag, or upload photos and screenshots to private storage. Agents can view supported images and add images using base64; URL downloads are an optional administrator setting.
- **Find things:** keyword search, tags, and optional semantic search using Supabase's built-in embedding model.
- **Recover changes:** note version history, conflict detection, note Trash, and a 30-day image Trash.
- **Use it on your phone:** add the web app to your home screen. This is a web app/PWA, not a native Apple Notes client.

## Your agents work with the same notes

Open **AI access**, create a separate key for each agent, and connect it to your app's `/api/mcp` endpoint.

| Key access | What the agent can do |
| --- | --- |
| Read only | Read and search every note, including history and images. |
| Add to Inbox | Read everything; create Inbox notes and edit or add images to notes still in the Inbox. |
| Full edit | Create, edit, tag, pin, move, trash, restore, and organize notes and folders. |

Agent changes appear in the activity log. Change permissions or revoke a key at any time. **Add to Inbox is not an append-only or folder-private key:** it can read all notes and edit all Inbox notes. Full edit is the broadest agent level; permanent deletion and key management remain owner actions in the app.

Examples:

> “Save this conversation's decisions to my Inbox.”
>
> “Find my notes about the garden and summarize the open questions.”
>
> “Organize my Inbox into the folders I already use. Preserve my wording.”
>
> “Add this screenshot to my project note.”

The server offers 23 tools over stateless Streamable HTTP with bearer-key authentication. Connection recipes are included for Codex, Claude Code, and generic MCP clients. A client must support remote HTTP MCP and this authentication method; support for every agent or plan is not assumed. The app supplies context when the agent calls its tools—it does not automatically insert every note into every chat.

## Own your installation

```text
Browser / phone ─── Vercel React app ─── Supabase Auth + Postgres + private Storage
AI agent ────────── Vercel /api/mcp ───── authenticated notes API in Postgres
                                        └── Edge Functions: images, semantic search
```

One owner per installation, identified by their Supabase Auth UUID. Row Level Security blocks other accounts. Agent keys are stored as hashes. The web app and Vercel MCP endpoint use only your Supabase publishable key. The Supabase Edge Functions use server-side credentials to manage images and embeddings.

Notes are Markdown text in Postgres, with an [export command](docs/data.md). You control the database, storage, backups, and deployment. This is **not end-to-end encryption**: the hosting providers and agents you authorize can process your data. [Security model →](SECURITY.md)

## Free-tier target

Designed for a personal installation on **Supabase Free + Vercel Hobby**. As checked November 3, 2026:

- Supabase Free includes a 500 MB database and 1 GB file storage, with usage quotas; projects can pause after a week of inactivity. [Provider pricing](https://supabase.com/pricing).
- Vercel Hobby is for personal, non-commercial use and has usage limits. Commercial use needs an eligible plan. [Hobby terms and limits](https://vercel.com/docs/plans/hobby).
- Semantic search uses built-in `gte-small`, with no external model API key. Embeddings, images, and agent calls still consume provider resources. Large image collections or frequent agent activity can exceed free quotas.

Free hosting is subject to provider terms and changes. No paid plan is required by the installation guide. Back up your notes independently.

## Develop and contribute

Node 22.14+ (Node 24 LTS recommended) and npm:

```sh
npm ci
npm test
npm run build
```

For a configured development workspace, copy `.env.example` to `.env.local`, supply your own public project values, and run `npm run dev`. Vite serves the UI only; use `vercel dev` for `/api/mcp`. Never point automated tests at your live database. See [CONTRIBUTING.md](CONTRIBUTING.md) for database, Edge Function, and MCP integration checks.

Built with React, Vite, Tailwind, Supabase, and Vercel. Inspired by the simplicity of Apple Notes; independent of Apple. Licensed under [MIT](LICENSE).
