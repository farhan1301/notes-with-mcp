import React, { useEffect, useRef } from 'react';
import { Bold, Heading1, Heading2, Heading3, Italic, List, ListOrdered, ListTodo, Pilcrow, Quote, Strikethrough } from 'lucide-react';

// Keep the textarea's focus and selection when a button is pressed.
const keepFocus = (e) => e.preventDefault();

const STYLES = [
  { kind: 'title', label: 'Title', icon: Heading1, className: 'text-xl font-bold' },
  { kind: 'heading', label: 'Heading', icon: Heading2, className: 'text-lg font-semibold' },
  { kind: 'subheading', label: 'Subheading', icon: Heading3, className: 'font-semibold' },
  { kind: 'body', label: 'Body', icon: Pilcrow, className: '' },
];

const LISTS = [
  { kind: 'bullet', label: 'Bulleted list', icon: List },
  { kind: 'number', label: 'Numbered list', icon: ListOrdered },
  { kind: 'check', label: 'Checklist', icon: ListTodo },
  { kind: 'quote', label: 'Quote', icon: Quote },
];

const INLINE = [
  { kind: 'bold', label: 'Bold', icon: Bold, keys: '⌘B' },
  { kind: 'italic', label: 'Italic', icon: Italic, keys: '⌘I' },
  { kind: 'strike', label: 'Strikethrough', icon: Strikethrough, keys: '⌘⇧X' },
];

/** Apple Notes-style "Aa" panel: text styles, lists and inline formatting. */
export default function FormatMenu({ active, onBlock, onInline, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const away = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('[data-format-toggle]')) onClose();
    };
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const item = (selected) => `flex items-center gap-2 rounded-lg px-3 py-2 text-left ${selected
    ? 'bg-amber-100 text-stone-900 dark:bg-amber-400/20 dark:text-stone-50'
    : 'hover:bg-stone-100 dark:hover:bg-neutral-800'}`;

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed inset-x-3 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.25rem)] z-30 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1 sm:w-64 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <div className="mb-1 grid grid-cols-1">
        {STYLES.map(({ kind, label, className }) => (
          <button key={kind} type="button" role="menuitem" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onBlock(kind)} className={item(active === kind)}>
            <span className={className}>{label}</span>
          </button>
        ))}
      </div>
      <div className="my-1 border-t border-stone-200 dark:border-neutral-700" />
      <div className="grid grid-cols-1">
        {LISTS.map(({ kind, label, icon: Icon }) => (
          <button key={kind} type="button" role="menuitem" onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onBlock(kind)} className={item(active === kind)}>
            <Icon size={17} className="text-amber-600 dark:text-amber-400" /> {label}
          </button>
        ))}
      </div>
      <div className="my-1 border-t border-stone-200 dark:border-neutral-700" />
      <div className="flex justify-around">
        {INLINE.map(({ kind, label, icon: Icon, keys }) => (
          <button key={kind} type="button" title={`${label} (${keys})`} aria-label={label} onPointerDown={keepFocus} onMouseDown={keepFocus} onClick={() => onInline(kind)} className="rounded-lg p-2.5 hover:bg-stone-100 dark:hover:bg-neutral-800">
            <Icon size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}
