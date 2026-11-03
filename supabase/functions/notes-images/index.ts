/**
 * Images in the private note-images bucket, for callers without the owner's
 * session.
 *
 *   GET  ?t=<token>          The image behind a one-hour link from
 *                            notes_image_links (how AI agents see images).
 *   POST {"action":"upload", note, image_url | image_base64, alt?, position?, after_text?}
 *                            with header x-notes-key: an AI agent adds an image
 *                            to a note (MCP tool add_image). The key needs
 *                            write access to that note: notes_api checks it
 *                            when the image goes into the note, and the
 *                            upload is removed again if it refuses.
 *   POST {"action":"purge"}  Deletes images whose time in the Trash is over
 *                            (or that were in a note deleted for good) from
 *                            Storage. Called by the app after Empty Trash /
 *                            Delete forever, and hourly by pg_cron.
 *
 * Links only open the one image they were made for. Purge requires the
 * owner session or scheduler secret. Uploads need a notes key. Deploy with verify_jwt off.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

import { downloadImage } from './download.ts';

const BUCKET = 'note-images';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notes-key',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const secretKey = () => {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
  return keys.default ?? Object.values(keys)[0];
};

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, secretKey() as string, {
  auth: { persistSession: false },
});

const publishableKey = (req: Request) => {
  const fromRequest = req.headers.get('apikey');
  if (fromRequest) return fromRequest;
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
  return (keys.default ?? Object.values(keys)[0]) as string;
};

const MAX_BYTES = 10 * 1024 * 1024;

/** The image type from the file's first bytes (what the file is, whatever it claims). */
const sniff = (b: Uint8Array): [string, string] | null => {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ['image/png', 'png'];
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return ['image/gif', 'gif'];
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return ['image/webp', 'webp'];
  if (ascii(4, 8) === 'ftyp' && /^(heic|heix|mif1|msf1)$/.test(ascii(8, 12))) return ['image/heic', 'heic'];
  if (ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return ['image/avif', 'avif'];
  return null;
};

class UploadError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** The image bytes from image_base64 (plain or a data: URL) or by downloading image_url. */
const imageBytes = async (body: Record<string, unknown>): Promise<Uint8Array> => {
  if (typeof body.image_base64 === 'string' && body.image_base64) {
    if (body.image_base64.length > 14 * 1024 * 1024) throw new UploadError('The image is larger than 10 MB.');
    const data = body.image_base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
    try {
      return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    } catch {
      throw new UploadError('image_base64 is not valid base64.');
    }
  }
  if (typeof body.image_url === 'string' && body.image_url) {
    const hosts = (Deno.env.get('NOTES_IMAGE_URL_HOSTS') || '').split(',').map((h) => h.trim()).filter(Boolean);
    try { return await downloadImage(body.image_url, hosts, MAX_BYTES); }
    catch (err) { throw new UploadError(err instanceof Error ? err.message : String(err)); }
  }
  throw new UploadError('Pass image_url or image_base64.');
};

const upload = async (req: Request, body: Record<string, unknown>) => {
  const key = req.headers.get('x-notes-key');
  if (!key) return json({ error: 'Send your notes key in x-notes-key.' }, 401);
  const note = String(body.note ?? '').trim();
  if (!note) return json({ error: 'Pass note (id or exact title).' }, 400);

  const asAgent = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(req), { auth: { persistSession: false } });
  const api = async (action: string, args: Record<string, unknown>) => {
    const { data, error } = await asAgent.rpc('notes_api', { p_token: key, p_action: action, p_args: args });
    if (error) throw new UploadError(error.message, error.code === '42501' ? 401 : 400);
    return data;
  };

  let path = '';
  try {
    const { data: target, error: denied } = await asAgent.rpc('notes_prepare_image_upload', { p_token: key, p_note: note });
    if (denied) throw new UploadError(denied.message, denied.code === '42501' ? 401 : 400);
    if (target.deleted_at) throw new UploadError('That note is in the Trash.');
    const bytes = await imageBytes(body);
    if (bytes.length > MAX_BYTES) throw new UploadError('The image is larger than 10 MB.');
    const type = sniff(bytes);
    if (!type) throw new UploadError('Not a supported image (JPEG, PNG, GIF, WebP, HEIC or AVIF).');

    path = `${target.id}/${crypto.randomUUID()}.${type[1]}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET)
      .upload(path, bytes, { contentType: type[0], cacheControl: '31536000' });
    if (uploadError) throw new UploadError(`Upload failed: ${uploadError.message}`, 502);

    const alt = String(body.alt ?? '').replace(/[[\]\n]/g, ' ').trim();
    const base = Deno.env.get('SUPABASE_URL')!.replace(/\/+$/, '');
    const markdown = `![${alt}](${base}/storage/v1/object/authenticated/${BUCKET}/${path})`;

    // notes_api checks the key may change this note, versions the edit and logs it.
    const afterText = typeof body.after_text === 'string' && body.after_text ? body.after_text : null;
    const result = afterText
      ? await api('edit_note', { note: target.id, old_text: afterText, new_text: `${afterText}\n\n${markdown}\n\n` })
      : await api('append_to_note', { note: target.id, text: markdown, position: body.position === 'start' ? 'start' : 'end' });
    return json({ note: result, image: { path, markdown, type: type[0], bytes: bytes.length } });
  } catch (err) {
    if (path) await supabase.storage.from(BUCKET).remove([path]);
    if (err instanceof UploadError) return json({ error: err.message }, err.status);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

const serveImage = async (token: string | null) => {
  if (!token) return json({ error: 'Pass ?t=<token> from notes_image_links.' }, 400);
  const { data: path, error } = await supabase.rpc('notes_image_ticket_path', { p_token: token });
  if (error) return json({ error: error.message }, 502);
  if (!path) return json({ error: 'This image link has expired. Read the note again for a new one.' }, 404);
  const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(path);
  if (downloadError || !file) return json({ error: 'This image no longer exists.' }, 404);
  return new Response(file, {
    headers: {
      ...CORS,
      'Content-Type': file.type || 'application/octet-stream',
      'Content-Length': String(file.size),
      'Cache-Control': 'private, max-age=3600',
    },
  });
};

const purge = async () => {
  let deleted = 0;
  const errors: string[] = [];
  for (let round = 0; round < 10; round += 1) {
    const { data: due, error } = await supabase.rpc('notes_images_due', { p_limit: 100 });
    if (error) {
      errors.push(error.message);
      break;
    }
    const paths = (due ?? []) as string[];
    if (!paths.length) break;
    // Removing a file that is already gone is not an error.
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);
    if (removeError) {
      errors.push(removeError.message);
      break;
    }
    const { data: forgotten, error: forgetError } = await supabase.rpc('notes_images_forget', { p_paths: paths });
    if (forgetError) {
      errors.push(forgetError.message);
      break;
    }
    deleted += forgotten ?? 0;
    if (paths.length < 100) break;
  }
  return json({ deleted, errors }, errors.length ? 500 : 200);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'GET') return serveImage(new URL(req.url).searchParams.get('t'));
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (body?.action === 'purge') {
      const cron = Deno.env.get('NOTES_CRON_SECRET');
      if (cron && req.headers.get('x-notes-cron-secret') === cron) return purge();
      const authorization = req.headers.get('Authorization');
      if (!authorization) return json({ error: 'Owner session required.' }, 401);
      const owner = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(req), {
        auth: { persistSession: false }, global: { headers: { Authorization: authorization } },
      });
      const { data, error } = await owner.rpc('notes_is_owner');
      if (error || data !== true) return json({ error: 'Owner session required.' }, 401);
      return purge();
    }
    if (body?.action === 'upload') return upload(req, body);
  }
  return json({ error: 'GET ?t=<token>, or POST {"action": "upload" | "purge"}' }, 400);
});
