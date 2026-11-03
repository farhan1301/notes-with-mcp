# Data, export, and backup

Your Supabase project contains your notes, folders, tags, version history, agent key hashes and activity, image metadata, and private image files. Vercel hosts the application and MCP endpoint. There is no upstream account or telemetry service in this app.

## Export a note

Open the note's menu and choose **Download .md**. This exports its text; private image URLs still require access to your instance. Use the full export below to bring the image bytes with you.

## Export all notes and current images

Use a read-only agent key. On your own computer, configure `.env.local` with your project URL and publishable key (as in `.env.example`) and securely set `NOTES_AGENT_KEY` in your shell environment. Then:

```sh
npm run export -- /absolute/private/path/to/a-new-export-folder
```

The folder must not exist. The script reads every current note, including Trash, downloads available private images, and writes:

- `notes/UUID.md`: Markdown with local links to exported images.
- `images/`: available image files.
- `notes.json` and `folders.json`: original text and metadata, including titles, folder paths, and tags.
- `manifest.json`: time, note count, and unavailable images. Exit code 2 means some images could not be exported.

This is a read-only portable export, not a transactional database snapshot. Avoid editing notes while it runs. It does not include version history, agent activity, key configuration, unused/trashed images absent from current note text, or authentication users. There is no automated import/restore UI yet. Keep exports outside this public repository; they contain your private notes.

## Back up the installation

For complete recovery, maintain a separate database backup **and** a copy of private Storage files. Database backups alone do not include the image bytes. Keep project configuration and the identity of the owner securely as well. Follow Supabase's current [backup documentation](https://supabase.com/docs/guides/platform/backups) and verify a restore into a separate project before relying on the backup.

Do not assume the Free plan provides daily recoverable backups. Notes version history helps undo edits; it does not protect against project loss. Images removed from all notes go to image Trash for 30 days. Permanently deleting a note or emptying Trash makes its unused images eligible for immediate deletion; old note versions may then show missing images.

Local drafts and cached note text live in browser storage to support interrupted connections. They are not encrypted application backups. Use a trusted device, and clear site data on shared devices after saving and signing out.
