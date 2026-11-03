/// <reference types="npm:@supabase/functions-js@2.118.0/src/edge-runtime.d.ts" />
/**
 * Search by keyword and by meaning: POST {"query": "...", "folder"?: "...", "limit"?: 10}
 *
 * Embeds the query with gte-small, then calls notes_api(..., 'search_notes')
 * with the caller's own credentials, so the database does the access check:
 *   - the web app sends the signed-in owner's session (Authorization: Bearer <jwt>)
 *   - agents (via /api/mcp on Vercel) send their notes key in x-notes-key
 * Deploy with verify_jwt off: agent requests carry no Supabase JWT.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const model = new Supabase.ai.Session('gte-small');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notes-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const publishableKey = (req: Request) => {
  const fromRequest = req.headers.get('apikey');
  if (fromRequest) return fromRequest;
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
  return (keys.default ?? Object.values(keys)[0]) as string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST {"query": "..."}' }, 405);

  let body: { query?: string; folder?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Body must be JSON.' }, 400);
  }
  const query = String(body.query ?? '').trim();
  if (!query) return json({ error: 'Pass a query.' }, 400);

  const notesKey = req.headers.get('x-notes-key');
  const authorization = req.headers.get('Authorization');
  const client = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(req), {
    auth: { persistSession: false },
    global: { headers: !notesKey && authorization ? { Authorization: authorization } : {} },
  });

  const { error: denied } = await client.rpc('notes_api', {
    p_token: notesKey, p_action: 'list_tags', p_args: {},
  });
  if (denied) return json({ error: 'Sign in as the owner or use a valid notes key.' }, 401);
  const embedding = await model.run(query, { mean_pool: true, normalize: true });
  const args: Record<string, unknown> = { query, embedding: Array.from(embedding as number[]) };
  if (body.limit) args.limit = body.limit;
  if ('folder' in body) args.folder = body.folder;

  const { data, error } = await client.rpc('notes_api', {
    p_token: notesKey,
    p_action: 'search_notes',
    p_args: args,
  });
  if (error) {
    const status = error.code === '42501' ? 401 : error.code === '22023' ? 400 : 502;
    return json({ error: error.message }, status);
  }
  return json(data);
});
