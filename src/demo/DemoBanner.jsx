import React, { useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { REPO_URL } from './mode';

/**
 * Bar across the top, shown only in demo mode. It sets --demo-banner to its
 * height so the app (NotesApp subtracts it from the screen height) fits below it and no
 * toast or button is covered. Dismissing it lasts until reload.
 */
export default function DemoBanner() {
  const [open, setOpen] = useState(true);
  const ref = useRef(null);

  useLayoutEffect(() => {
    const root = document.documentElement.style;
    if (!open || !ref.current) {
      root.removeProperty('--demo-banner');
      return undefined;
    }
    const el = ref.current;
    const update = () => root.setProperty('--demo-banner', `${el.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { observer.disconnect(); root.removeProperty('--demo-banner'); };
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="status"
      className="flex items-center gap-2 bg-stone-900 pl-4 pr-2 pt-[env(safe-area-inset-top)] text-[13px] text-stone-100 dark:bg-stone-100 dark:text-stone-900"
    >
      <p className="min-w-0 flex-1 py-2 text-center">
        You're trying the demo: sample data, nothing is saved.{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="whitespace-nowrap font-semibold text-amber-400 underline-offset-2 hover:underline dark:text-amber-700">
          Get your own →
        </a>
      </p>
      <button type="button" onClick={() => setOpen(false)} aria-label="Dismiss demo notice" className="shrink-0 rounded-full p-1.5 hover:bg-white/10 dark:hover:bg-black/10">
        <X size={15} />
      </button>
    </div>
  );
}
