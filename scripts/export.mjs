import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Read-only export. Uses only the publishable key and a notes agent key.
const base = (process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const publicKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const agentKey = process.env.NOTES_AGENT_KEY;
const target = process.argv[2];
const rpc = async (name, args) => {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: publicKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(args), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Export RPC failed (${response.status}). Check configuration and key access.`);
  return response.json();
};
const api = (action, args = {}) => rpc('notes_api', { p_token: agentKey, p_action: action, p_args: args });

try {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !publicKey || !agentKey || !target) {
    throw new Error('Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and NOTES_AGENT_KEY; run npm run export -- /private/new-export-folder');
  }
  const root = resolve(target);
  // Refuse to overwrite a prior backup.
  await mkdir(root, { mode: 0o700 });
  await mkdir(`${root}/notes`, { mode: 0o700 });
  await mkdir(`${root}/images`, { mode: 0o700 });
  const folders = await api('list_folders');
  await writeFile(`${root}/folders.json`, JSON.stringify(folders, null, 2), { mode: 0o600 });
  const notes = [];
  const missingImages = [];
  for (const trash of [false, true]) {
    for (let offset = 0; ; offset += 200) {
      const page = await api('list_notes', { trash, offset, limit: 200 });
      for (const entry of page.notes || []) {
        if (!/^[0-9a-f-]{36}$/i.test(entry.id)) throw new Error('Invalid note ID in export response.');
        const note = await api('get_note', { note: entry.id });
        notes.push(note);
        let markdown = note.content;
        if (markdown.includes('/note-images/')) {
          const links = await rpc('notes_image_links', { p_token: agentKey, p_note: note.id });
          for (const [i, image] of (links.images || []).entries()) {
            try {
              const url = new URL(image.url);
              if (url.origin !== new URL(base).origin || url.pathname !== '/functions/v1/notes-images') throw new Error('Unexpected image host.');
              const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const bytes = new Uint8Array(await response.arrayBuffer());
              if (bytes.length > 10 * 1024 * 1024) throw new Error('Image exceeds expected size.');
              const ext = image.path.match(/\.(jpg|jpeg|png|gif|webp|heic|heif|avif)$/i)?.[1] || 'img';
              const name = `${note.id}-${i}.${ext}`;
              await writeFile(`${root}/images/${name}`, bytes, { mode: 0o600 });
              const escaped = image.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              markdown = markdown.replace(new RegExp(`https?://[^\\s)]*/storage/v1/object/(?:authenticated|public|sign)/note-images/${escaped}(?:[?#][^\\s)]*)?`, 'g'), `../images/${name}`);
            } catch {
              missingImages.push({ note_id: note.id, path: image.path });
            }
          }
        }
        await writeFile(`${root}/notes/${note.id}.md`, `# ${note.title}\n\n${markdown}`, { mode: 0o600 });
      }
      if ((page.notes || []).length < 200) break;
    }
  }
  await writeFile(`${root}/notes.json`, JSON.stringify(notes, null, 2), { mode: 0o600 });
  await writeFile(`${root}/manifest.json`, JSON.stringify({ exported_at: new Date().toISOString(), note_count: notes.length, includes_trash: true, includes_version_history: false, missing_images: missingImages }, null, 2), { mode: 0o600 });
  console.log(`Exported ${notes.length} notes. ${missingImages.length} image(s) unavailable; see manifest.json. Export contains private data.`);
  if (missingImages.length) process.exitCode = 2;
} catch (err) { console.error(err.message); process.exitCode = 1; }
