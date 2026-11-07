/// <reference types="npm:@supabase/functions-js@2.118.0/src/edge-runtime.d.ts" />
/**
 * Keeps the meaning-search index up to date: embeds every note whose text
 * changed since it was last embedded (notes.content_hash <> embedded_hash),
 * using Supabase's built-in gte-small model. No external API key.
 *
 * pg_cron calls it every minute while notes are waiting (see
 * supabase/schedules.sql). It only ever processes pending
 * notes and returns counts, so it requires the private scheduler secret (deploy with verify_jwt off).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { chunkNote } from './chunk.ts';

const model = new Supabase.ai.Session('gte-small');

const secretKey = () => {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
  return keys.default ?? Object.values(keys)[0];
};

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, secretKey() as string, {
  auth: { persistSession: false },
});

const TIME_BUDGET_MS = 40_000;

Deno.serve(async (req) => {
  const expected = Deno.env.get('NOTES_CRON_SECRET');
  if (!expected || req.headers.get('x-notes-cron-secret') !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const started = Date.now();
  let embedded = 0;
  let skipped = 0;
  const errors: string[] = [];

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: pending, error } = await supabase.rpc('notes_pending_embeddings', { p_limit: 5 });
    if (error) {
      errors.push(error.message);
      break;
    }
    if (!pending?.length) break;

    let progressed = false;
    for (const note of pending) {
      try {
        const chunks = [];
        for (const text of chunkNote(note.title, note.content)) {
          const embedding = await model.run(text, { mean_pool: true, normalize: true });
          chunks.push({ content: text, embedding: Array.from(embedding as number[]) });
        }
        const { data: stored, error: storeError } = await supabase.rpc('notes_store_embeddings', {
          p_note_id: note.id,
          p_hash: note.content_hash,
          p_chunks: chunks,
        });
        if (storeError) throw storeError;
        if (stored) embedded += 1; else skipped += 1;
        progressed = true;
      } catch (err) {
        errors.push(`${note.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    // Every note in the batch failed: stop instead of retrying them in a loop.
    if (!progressed) break;
  }

  return new Response(JSON.stringify({ embedded, skipped, errors }), {
    status: errors.length && !embedded ? 500 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
