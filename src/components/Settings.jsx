import React, { useCallback, useEffect, useState } from 'react';
import { Check, ChevronLeft, Copy, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useDialog } from './Dialog';

const mcpUrl = (key) => `${window.location.origin}/api/mcp?key=${key}`;

const ACCESS_LEVELS = [
  { value: 'read', label: 'Read only', help: 'Read and search notes' },
  { value: 'inbox', label: 'Add to Inbox', help: 'Read, add notes to the Inbox, and add to or edit notes still in the Inbox' },
  { value: 'edit', label: 'Full edit', help: 'Add, change, move, organise and delete any note or folder' },
];

/** Keys made before access levels only have can_write. */
const keyAccess = (key) => key.access || (key.can_write ? 'edit' : 'read');

const CopyButton = ({ text, label = 'Copy' }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-stone-200/70 px-3 py-1.5 text-sm dark:bg-neutral-800"
    >
      {done ? <Check size={15} /> : <Copy size={15} />} {done ? 'Copied' : label}
    </button>
  );
};

/** AI access: notes keys for agents (MCP) and the log of what agents changed. */
export default function Settings({ onBack }) {
  const dialog = useDialog();
  const [keys, setKeys] = useState([]);
  const [actions, setActions] = useState([]);
  const [created, setCreated] = useState(null);
  const [label, setLabel] = useState('');
  const [access, setAccess] = useState('read');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [{ data: keyData, error: keyError }, { data: actionData, error: actionError }] = await Promise.all([
      supabase.rpc('list_note_agent_keys'),
      supabase.from('note_agent_actions').select('id, key_label, action, summary, note_id, created_at').order('id', { ascending: false }).limit(50),
    ]);
    setError(keyError?.message || actionError?.message || '');
    setKeys(keyData || []);
    setActions(actionData || []);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async (e) => {
    e.preventDefault();
    const { data, error: createError } = await supabase.rpc('create_note_agent_key', { p_label: label.trim(), p_access: access });
    if (createError) {
      setError(createError.message);
      return;
    }
    setCreated(data);
    setLabel('');
    refresh();
  };

  const setKeyAccess = async (key, value) => {
    const { error: accessError } = await supabase.rpc('set_note_agent_key_access', { p_id: key.id, p_access: value });
    if (accessError) setError(accessError.message);
    refresh();
  };

  const revoke = async (key) => {
    if (!(await dialog.confirm(`Revoke ${key.label}?`, 'Agents using this key lose access immediately.', 'Revoke', true))) return;
    await supabase.rpc('revoke_note_agent_key', { p_id: key.id });
    refresh();
  };

  return (
    <section className="flex h-full flex-col">
      <header className="px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onBack} className="-ml-2 mb-3 flex items-center text-amber-600 md:hidden dark:text-amber-400">
          <ChevronLeft size={24} /> <span className="text-[15px]">Folders</span>
        </button>
        <h2 className="text-2xl font-bold tracking-tight">AI access</h2>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-10">
        <div className="max-w-2xl space-y-8">
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Give each AI agent its own key. Agents connect through MCP to read, search, write and organise your notes.
            Each key is <b>Read only</b>, <b>Add to Inbox</b> (new notes land in the Inbox and only Inbox notes can be added to or edited) or <b>Full edit</b>.
            Agent changes are listed below. Earlier note text can be restored from version history.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}

          <form onSubmit={create} className="space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-neutral-900">
            <h3 className="font-semibold">New key</h3>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Agent key name"
              placeholder="Name, e.g. Claude"
              className="w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 outline-none focus:border-amber-500 dark:border-neutral-700"
            />
            <fieldset className="space-y-1.5 text-sm">
              <legend className="mb-1 text-stone-600 dark:text-stone-400">Access</legend>
              {ACCESS_LEVELS.map((level) => (
                <label key={level.value} className="flex items-start gap-2">
                  <input type="radio" name="access" value={level.value} checked={access === level.value} onChange={() => setAccess(level.value)} className="mt-0.5 h-4 w-4 accent-amber-500" />
                  <span><b className="font-medium">{level.label}</b> <span className="text-stone-500">({level.help})</span></span>
                </label>
              ))}
            </fieldset>
            <button type="submit" disabled={!label.trim()} className="inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 font-medium text-white disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900">
              <KeyRound size={16} /> Create key
            </button>
          </form>

          {created && (
            <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950/40">
              <p className="font-semibold">Key for {created.label}. Copy it now: it is not shown again.</p>
              <div>
                <p className="mb-1 text-stone-600 dark:text-stone-400">MCP server URL (for clients that accept a URL):</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 dark:bg-neutral-900">{mcpUrl(created.key)}</code>
                  <CopyButton text={mcpUrl(created.key)} />
                </div>
              </div>
              <div>
                <p className="mb-1 text-stone-600 dark:text-stone-400">Claude Code:</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 dark:bg-neutral-900">{`claude mcp add --transport http notes "${mcpUrl(created.key)}"`}</code>
                  <CopyButton text={`claude mcp add --transport http notes "${mcpUrl(created.key)}"`} />
                </div>
              </div>
              <div>
                <p className="mb-1 text-stone-600 dark:text-stone-400">Codex (set NOTES_AGENT_KEY privately in the environment that launches Codex):</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 dark:bg-neutral-900">{`codex mcp add notes --url ${window.location.origin}/api/mcp --bearer-token-env-var NOTES_AGENT_KEY`}</code>
                  <CopyButton text={`codex mcp add notes --url ${window.location.origin}/api/mcp --bearer-token-env-var NOTES_AGENT_KEY`} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-stone-500">Agent key:</span>
                  <code className="min-w-0 flex-1 truncate">{created.key}</code>
                  <CopyButton text={created.key} label="Copy key" />
                </div>
              </div>
              <p className="text-stone-500">Other HTTP MCP clients: use {window.location.origin}/api/mcp with an Authorization: Bearer header, or the key URL above. Treat the URL as a password. Client features and plans vary.</p>
              <button type="button" onClick={() => setCreated(null)} className="text-stone-500 underline">Done</button>
            </div>
          )}

          <div>
            <h3 className="mb-2 font-semibold">Keys</h3>
            {keys.length === 0 && <p className="text-sm text-stone-500">No keys yet.</p>}
            <ul className="divide-y divide-stone-200 rounded-2xl bg-white shadow-sm dark:divide-neutral-800 dark:bg-neutral-900">
              {keys.map((k) => (
                <li key={k.id} className={`flex flex-wrap items-center gap-2 p-3 text-sm ${k.revoked_at ? 'opacity-50' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{k.label} <span className="font-mono text-xs text-stone-400">{k.token_prefix}…</span></div>
                    <div className="text-xs text-stone-500">
                      {k.revoked_at ? 'Revoked' : k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleString()}` : 'Never used'}
                    </div>
                  </div>
                  {!k.revoked_at && (
                    <>
                      <select
                        value={keyAccess(k)}
                        onChange={(e) => setKeyAccess(k, e.target.value)}
                        aria-label={`Access for ${k.label}`}
                        title={ACCESS_LEVELS.find((level) => level.value === keyAccess(k))?.help}
                        className="rounded-lg border border-stone-300 bg-transparent px-2 py-1 outline-none focus:border-amber-500 dark:border-neutral-700 dark:bg-neutral-900"
                      >
                        {ACCESS_LEVELS.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
                      </select>
                      <button type="button" onClick={() => revoke(k)} className="rounded-lg px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950">Revoke</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Recent agent changes</h3>
            {actions.length === 0 && <p className="text-sm text-stone-500">Nothing yet.</p>}
            <ul className="space-y-1 text-sm">
              {actions.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="w-32 shrink-0 text-stone-400">{new Date(a.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <span><b>{a.key_label}</b>: {a.summary || a.action}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
