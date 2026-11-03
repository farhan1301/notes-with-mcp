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

## AI access: connect your notes to your agents

Your notes can be a **context layer you own**, shared across the AI agents you use. Keep ideas, plans, decisions, reference material, and images in one place. Each connected agent can find and work with those notes using the access you give it.

### 1. Create a key for each agent

Open **AI access** in the notes app, give the key a name such as “ChatGPT”, “Claude Code”, or “Codex”, and choose its permissions. Create separate keys so you can change or revoke one agent's access independently.

| Key access | What the agent can do |
| --- | --- |
| Read only | Read and search every note, including history and images. |
| Add to Inbox | Read everything; create Inbox notes and edit or add images to notes still in the Inbox. |
| Full edit | Create, edit, tag, pin, move, trash, restore, and organize notes and folders. |

Agent changes appear in the activity log. Change permissions or revoke a key at any time. **Add to Inbox is not an append-only or folder-private key:** it can read all notes and edit all Inbox notes. Full edit is the broadest agent level; permanent deletion and key management remain owner actions in the app.

### 2. Add your notes as a custom MCP connection

AI access shows the connection URL and setup commands when you create a key. Copy them into your agent's custom MCP or plugin settings.

| Agent | How to connect |
| --- | --- |
| **ChatGPT** | On the web, open **[Plugins](https://chatgpt.com/plugins)** → **+** → **Add custom MCP server**. Name it “My Notes”, paste the key URL from AI access as the Server URL, and select **Create as a plugin**. Install the plugin, then select it with `@` in your conversation. |
| **Claude Code** | Add the connection with `claude mcp add --transport http notes "YOUR_MCP_KEY_URL"`. AI access provides the command with your own URL. |
| **Codex** | Use the command in AI access to add the MCP endpoint, with your key supplied through the private `NOTES_AGENT_KEY` environment variable. |
| **Other MCP-capable agents** | Add a custom remote MCP server using your endpoint and an Authorization bearer key, or the key URL if the client accepts URL-based connections. |

For ChatGPT's key-URL connection, choose **No authentication** if the creation screen asks for an authentication method: the key included in the URL authenticates requests to your notes app. Keep that URL private, just like a password. Custom plugin access depends on your account and workspace permissions. See the [official ChatGPT setup guide](https://developers.openai.com/api/docs/guides/custom-mcp-server) and our [detailed agent connection guide](docs/agents.md).

![AI access showing key permissions and agent connection instructions](docs/ai-access.png)

*Example connection screen with a fictional key.*

### 3. Use the same context across agents

Save research with ChatGPT, ask Claude Code to use those notes while building a project, and ask Codex to record the resulting decisions. The next agent can pick up from the notes already saved, with less repeated explanation and copy-pasting.

You choose what to save and which agents can change it. Your notes stay in your database as you switch agents, and the app remains a place where you can read and edit them yourself. Agents retrieve relevant notes on demand through MCP; saved notes and supported images form the shared context, while each agent's conversation history stays with that agent.

Examples:

> “Save this conversation's decisions to my Inbox.”
>
> “Find my notes about the garden and summarize the open questions.”
>
> “Organize my Inbox into the folders I already use. Preserve my wording.”
>
> “Add this screenshot to my project note.”

The server offers 23 tools over stateless Streamable HTTP with bearer-key authentication. Use a client that supports remote HTTP MCP and either bearer headers or a key URL. See [the connection guide](docs/agents.md) for configuration, supported operations, and a quick connection check.

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
