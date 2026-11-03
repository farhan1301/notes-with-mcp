import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { ImageOff, Loader2 } from 'lucide-react';
import { imagePath } from '../lib/markdown';
import { signedImageUrl } from '../lib/images';

/**
 * An image in a note. Images uploaded to the private bucket are loaded through
 * a temporary signed URL; other images load as they are. Clicking opens the
 * full-size image.
 */
function NoteImage({ src = '', alt = '', title }) {
  const path = imagePath(src);
  const [url, setUrl] = useState(path ? null : src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!path) {
      setUrl(src);
      return undefined;
    }
    setUrl(null);
    Promise.resolve(signedImageUrl(path))
      .then((signedUrl) => active && setUrl(signedUrl))
      .catch(() => active && setFailed(true));
    return () => { active = false; };
  }, [src, path]);

  if (failed) {
    return (
      <span data-image className="not-prose my-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-400 dark:border-neutral-700">
        <ImageOff size={16} /> {alt || 'Image not available offline'}
      </span>
    );
  }
  if (!url) {
    return (
      <span data-image className="not-prose my-2 flex h-40 w-full max-w-md items-center justify-center rounded-lg bg-stone-100 text-stone-400 dark:bg-neutral-800">
        <Loader2 size={18} className="animate-spin" />
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" data-image className="not-prose my-2 inline-block max-w-full">
      <img
        src={url}
        alt={alt}
        title={title}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-[70vh] max-w-full rounded-lg border border-stone-200/70 object-contain dark:border-neutral-800"
      />
    </a>
  );
}

const findCheckbox = (node) => {
  if (!node) return null;
  if (node.tagName === 'input') return node;
  for (const child of node.children || []) {
    const found = findCheckbox(child);
    if (found) return found;
  }
  return null;
};

// Blocks carry their source line so a click can put the cursor there.
const withLine = (Tag) => function Block({ node, ...props }) {
  return <Tag data-line={node?.position?.start.line} {...props} />;
};
const BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'hr'];
const blockComponents = Object.fromEntries(BLOCK_TAGS.map((tag) => [tag, withLine(tag)]));

/**
 * Renders a note's Markdown (GitHub flavour: tables, task lists, strikethrough,
 * autolinks). Single line breaks are kept, as dictated text expects. Ticking a checkbox
 * calls onToggleTask(line) with the 1-based source line.
 */
export default function Markdown({ content, onToggleTask }) {
  const components = {
    ...blockComponents,
    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
    input: () => null,
    img: ({ node, ...props }) => <NoteImage {...props} />,
    li: ({ node, className, children, ...props }) => {
      const box = className?.includes('task-list-item') ? findCheckbox(node) : null;
      const line = node.position?.start.line;
      if (!box) return <li className={className} data-line={line} {...props}>{children}</li>;
      return (
        <li className="task-list-item -ml-5 flex list-none items-start gap-2" data-line={line} {...props}>
          <input
            type="checkbox"
            checked={Boolean(box.properties?.checked)}
            disabled={!onToggleTask || !line}
            onChange={() => onToggleTask(line)}
            className="mt-[0.45em] h-4 w-4 shrink-0 accent-amber-500"
          />
          <div className={box.properties?.checked ? 'text-stone-400 line-through' : ''}>{children}</div>
        </li>
      );
    },
  };

  return (
    <div className="prose prose-stone max-w-none break-words dark:prose-invert prose-headings:font-semibold prose-a:text-amber-700 dark:prose-a:text-amber-400 prose-li:my-0.5 prose-p:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
