import React, { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';
import { supabase, isNetworkError } from '../lib/supabase';
import { load, save } from '../lib/storage';

const OWNER_KEY = 'notes-with-mcp:owner';
const GOOGLE_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_AUTH === 'true';

/** One explicitly configured owner per installation. No public sign-up. */
export default function AuthGate({ children }) {
  const [status, setStatus] = useState(supabase ? 'loading' : 'misconfigured');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const check = async (session) => {
      if (!session) {
        if (active) setStatus('signed_out');
        return;
      }
      const { data, error } = await supabase.rpc('notes_is_owner');
      if (!active) return;
      if (error) {
        if (isNetworkError(error) && load(OWNER_KEY, null) === session.user.id) {
          setStatus('ready');
          return;
        }
        setStatus('error');
        setMessage(error.message);
        return;
      }
      if (data !== true) {
        save(OWNER_KEY, null);
        setMessage('This account does not have access to these notes.');
        setStatus('denied');
        await supabase.auth.signOut();
        return;
      }
      save(OWNER_KEY, session.user.id);
      setMessage('');
      setStatus('ready');
    };
    supabase.auth.getSession().then(({ data, error }) => {
      if (error && active) { setMessage(error.message); setStatus('error'); }
      else check(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Defer Supabase API calls until the auth callback releases its lock.
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setTimeout(() => active && check(session), 0);
      if (event === 'SIGNED_OUT' && active) setStatus((s) => s === 'denied' ? s : 'signed_out');
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  const signIn = async (event) => {
    event.preventDefault();
    setStatus('loading');
    setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPassword('');
    if (error) { setStatus('error'); setMessage(error.message); }
  };
  const signInGoogle = async () => {
    setStatus('loading');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: window.location.origin },
    });
    if (error) { setStatus('error'); setMessage(error.message); }
  };
  if (status === 'ready') return children;
  const inputClass = 'w-full rounded-xl border border-stone-300 bg-transparent px-3 py-3 dark:border-neutral-700';
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50 p-6 dark:bg-neutral-950">
      <div className="w-full max-w-sm text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-5 h-16 w-16 rounded-2xl shadow-sm" />
        <h1 className="mb-1 text-2xl font-semibold text-stone-900 dark:text-stone-100">Notes with MCP</h1>
        <p className="mb-6 text-sm text-stone-500">Your notes. Your data. Your AI agents.</p>
        {status === 'loading' && <p className="text-stone-500" role="status">Signing in…</p>}
        {status === 'misconfigured' && <p className="text-stone-500">Finish the installation steps in INSTALL.md to connect your workspace.</p>}
        {['signed_out', 'denied', 'error'].includes(status) && (
          <>
            {message && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{message}</p>}
            <form onSubmit={signIn} className="space-y-3 text-left">
              <label className="block text-sm">Email
                <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
              </label>
              <label className="block text-sm">Password
                <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </label>
              <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 font-medium text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900">
                <LogIn size={18} /> Sign in
              </button>
            </form>
            {GOOGLE_ENABLED && <button type="button" onClick={signInGoogle} className="mt-4 text-sm text-amber-700 dark:text-amber-400">Sign in with Google</button>}
          </>
        )}
      </div>
    </div>
  );
}
