import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const DialogContext = createContext(null);

/**
 * Promise-based prompt / confirm / choose dialogs:
 *   const { prompt, confirm, choose } = useDialog();
 *   const name = await prompt('New folder', '');           // string or null
 *   if (await confirm('Delete?', 'Details', 'Delete')) …   // boolean
 *   const id = await choose('Move to', [{ value, label }]) // value or null
 */
export const useDialog = () => useContext(DialogContext);

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const open = useCallback((spec) => new Promise((resolve) => setDialog({ ...spec, resolve })), []);
  const close = (value) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  const api = {
    prompt: (title, value = '', action = 'Save') => open({ kind: 'prompt', title, value, action }),
    confirm: (title, body = '', action = 'OK', danger = false) => open({ kind: 'confirm', title, body, action, danger }),
    choose: (title, options) => open({ kind: 'choose', title, options }),
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {dialog && <DialogView dialog={dialog} onClose={close} />}
    </DialogContext.Provider>
  );
}

function DialogView({ dialog, onClose }) {
  const [value, setValue] = useState(dialog.value || '');
  const inputRef = useRef(null);
  const cancel = () => onClose(dialog.kind === 'confirm' ? false : null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e) => {
    e.preventDefault();
    if (dialog.kind === 'prompt') onClose(value.trim() ? value.trim() : null);
    else onClose(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" onClick={cancel}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="mb-3 text-lg font-semibold">{dialog.title}</h2>
        {dialog.body && <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">{dialog.body}</p>}
        {dialog.kind === 'prompt' && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mb-4 w-full rounded-lg border border-stone-300 bg-transparent px-3 py-2 outline-none focus:border-accent dark:border-neutral-700"
          />
        )}
        {dialog.kind === 'choose' && (
          <div className="mb-4 max-h-80 overflow-y-auto">
            {dialog.options.map((o) => (
              <button
                key={o.value ?? 'null'}
                type="button"
                onClick={() => onClose(o.value)}
                className="block w-full rounded-lg px-3 py-2 text-left hover:bg-stone-100 dark:hover:bg-neutral-800"
                style={{ paddingLeft: `${0.75 + (o.depth || 0) * 1}rem` }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={cancel} className="rounded-lg px-4 py-2 text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-neutral-800">
            Cancel
          </button>
          {dialog.kind !== 'choose' && (
            <button
              type="submit"
              className={`rounded-lg px-4 py-2 font-medium text-white ${dialog.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-stone-900 hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900'}`}
            >
              {dialog.action}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
