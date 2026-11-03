/**
 * Shared helpers for the AI agent endpoint (api/mcp.js).
 *
 * Every call goes through the Supabase function notes_api, which checks the
 * agent key itself, so this only needs the public URL and publishable key,
 * never the secret key. Writes depend on the key's access level (read only,
 * add to Inbox, or full edit), which notes_api enforces.
 */
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

class AgentError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

/** The agent key from `Authorization: Bearer …` or `?key=…`. */
const getAgentKey = (req) => {
  const auth = req.headers.authorization || '';
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const key = req.query?.key;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
};

const parse = async (response) => {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
};

const assertConfigured = () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new AgentError('Server is missing the Supabase URL or publishable key.');
};

/** Calls a database function as the agent (it checks the key itself). */
const callRpc = async (fn, params) => {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const body = await parse(response);
  if (!response.ok) {
    const message = body?.message || `Supabase returned ${response.status}`;
    const denied = body?.code === '42501' || response.status === 401 || response.status === 403;
    const badInput = body?.code === '22023' || body?.code === '40001';
    throw new AgentError(message, denied ? 401 : badInput ? 400 : 502);
  }
  return body;
};

/** Calls notes_api(key, action, args) and returns its JSON result. */
const callApi = (key, action, args = {}) => callRpc('notes_api', { p_token: key, p_action: action, p_args: args });

// Images Claude and other MCP clients accept. Vercel caps a response at
// 4.5 MB, so one reply carries at most about 3 MB of images (4 MB as base64).
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const IMAGE_BUDGET = 3 * 1024 * 1024;
const IMAGES_PER_CALL = 8;

/**
 * The images in a note as MCP content (text label + image), starting at
 * `offset`, as many as fit in one reply. Uses one-hour links from
 * notes_image_links, which checks the key like get_note does.
 */
const noteImages = async (key, note, offset = 0) => {
  const links = await callRpc('notes_image_links', { p_token: key, p_note: note });
  const images = links?.images || [];
  const content = [];
  let used = 0;
  let index = offset;
  for (; index < images.length && index < offset + IMAGES_PER_CALL; index += 1) {
    const image = images[index];
    const label = `Image ${index + 1} of ${images.length}${image.alt ? ` ("${image.alt}")` : ''}`;
    try {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = (response.headers.get('content-type') || '').split(';')[0];
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!IMAGE_TYPES.has(type)) {
        content.push({ type: 'text', text: `${label}: ${type || 'unknown'} format, which cannot be shown here.` });
        continue;
      }
      if (bytes.length > IMAGE_BUDGET) {
        content.push({ type: 'text', text: `${label}: too large to send (${(bytes.length / 1048576).toFixed(1)} MB).` });
        continue;
      }
      if (used + bytes.length > IMAGE_BUDGET && used > 0) break;
      used += bytes.length;
      content.push({ type: 'text', text: label }, { type: 'image', data: bytes.toString('base64'), mimeType: type });
    } catch (err) {
      content.push({ type: 'text', text: `${label}: could not be loaded (${err.message}).` });
    }
  }
  if (index < images.length) {
    content.push({ type: 'text', text: `${images.length - index} more image(s): call get_note_images with note "${links.note_id}" and offset ${index}.` });
  }
  return { content, total: images.length };
};

/**
 * Adds an image to a note through the notes-images Edge Function, which
 * uploads it to the private bucket and inserts it with the agent's key
 * (so notes_api checks the key may change that note).
 */
const addImage = async (key, args) => {
  assertConfigured();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/notes-images`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'x-notes-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'upload', ...args }),
  });
  const body = await parse(response);
  if (!response.ok) {
    throw new AgentError(body?.error || `Adding the image failed (${response.status})`, response.status === 401 ? 401 : 400);
  }
  return body;
};

/**
 * Keyword + meaning search through the notes-search Edge Function (it embeds
 * the query). Falls back to keyword-only search if the function is down.
 */
const searchNotes = async (key, args) => {
  assertConfigured();
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/notes-search`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'x-notes-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await parse(response);
    if (response.ok) return body;
    // Bad key or bad input: same answer the keyword search would give.
    if (response.status === 400 || response.status === 401) {
      throw new AgentError(body?.error || `Search failed (${response.status})`, response.status);
    }
  } catch (err) {
    if (err instanceof AgentError) throw err;
  }
  const result = await callApi(key, 'search_notes', args);
  return { ...result, note: 'Meaning-based search is unavailable right now; these are keyword matches only.' };
};

const setCommonHeaders = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version');
  res.setHeader('Cache-Control', 'no-store');
};

module.exports = { AgentError, addImage, callApi, getAgentKey, noteImages, searchNotes, setCommonHeaders };
