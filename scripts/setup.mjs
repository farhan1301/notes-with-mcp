import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function configuration(projectUrl, ownerId, secret = randomBytes(32).toString('hex')) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(projectUrl || '')) {
    throw new Error('Use your hosted project URL: https://<project-ref>.supabase.co (no trailing slash).');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId || '')) {
    throw new Error('owner-id must be the UUID of your Supabase Auth user.');
  }
  if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error('Expected a 32-byte hex secret.');
  return {
    sql: `-- PRIVATE. Run in YOUR project SQL Editor, after the migration. Never commit.\nbegin;\ninsert into notes_private.settings (singleton, owner_user_id, project_url, cron_secret)\nvalues (true, '${ownerId}', '${projectUrl}', '${secret}')\non conflict (singleton) do update set owner_user_id = excluded.owner_user_id,\n  project_url = excluded.project_url, cron_secret = excluded.cron_secret;\ncommit;\n`,
    env: `NOTES_CRON_SECRET=${secret}\n`,
  };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--project-url' || args[2] !== '--owner-id') {
      throw new Error('Usage: npm run setup -- --project-url https://<ref>.supabase.co --owner-id <Auth-user-UUID>');
    }
    const config = configuration(args[1], args[3]);
    await mkdir('.setup', { recursive: true, mode: 0o700 });
    await writeFile('.setup/configure.sql', config.sql, { mode: 0o600, flag: 'wx' });
    await writeFile('.setup/functions.env', config.env, { mode: 0o600, flag: 'wx' });
    console.log('Created private .setup/configure.sql and .setup/functions.env. Follow INSTALL.md steps 3–4. Secret values were not printed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
