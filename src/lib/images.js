import { supabase } from './supabase';
import { IMAGE_BUCKET, imageMarkdown } from './markdown';

const MAX_SIDE = 2560; // px: plenty for a note, and keeps phone photos small
const MAX_BYTES = 10 * 1024 * 1024; // the bucket's limit
const SIGNED_FOR = 60 * 60; // seconds

/** True for files the app treats as images (some phones send HEIC without a type). */
export const isImageFile = (file) => file && (file.type.startsWith('image/') || /\.(heic|heif)$/i.test(file.name));

const decode = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => resolve({ img, url });
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Not a readable image'));
  };
  img.src = url;
});

/**
 * Shrinks large photos to at most 2560 px on the long side (as JPEG, or WebP/PNG
 * for images that may be transparent). GIFs (animation) and images the browser
 * cannot read (e.g. HEIC outside Safari) are uploaded as they are.
 */
const prepare = async (file) => {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    return file;
  }
  const { img, url } = decoded;
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const convert = !/^image\/(jpeg|png|webp)$/.test(file.type); // HEIC/AVIF/etc → JPEG
    if (scale === 1 && !convert && file.size <= 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const alpha = file.type === 'image/png' || file.type === 'image/webp';
    const toBlob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    let blob = alpha ? await toBlob('image/webp', 0.9) : await toBlob('image/jpeg', 0.85);
    if (alpha && blob?.type !== 'image/webp') blob = await toBlob('image/png');
    return blob && blob.size < file.size ? blob : file;
  } finally {
    URL.revokeObjectURL(url);
  }
};

const EXTENSIONS = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif',
};

/**
 * Uploads an image for a note to the private note-images bucket and returns
 * the Markdown to insert ("![](…/note-images/<note id>/<random>.jpg)").
 */
export const uploadImage = async (file, noteId) => {
  const body = await prepare(file);
  if (body.size > MAX_BYTES) throw new Error(`"${file.name || 'Image'}" is larger than 10 MB.`);
  const type = body.type || (/\.heif$/i.test(file.name) ? 'image/heif' : 'image/heic');
  const path = `${noteId}/${crypto.randomUUID()}.${EXTENSIONS[type] || 'img'}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, body, { contentType: type, cacheControl: '31536000' });
  if (error) throw error;
  return imageMarkdown(import.meta.env.VITE_SUPABASE_URL, path);
};

// path → Promise<signed URL>, refreshed before it expires.
const signed = new Map();

/** A temporary URL the browser can load for an image in the private bucket. */
export const signedImageUrl = (path) => {
  const cached = signed.get(path);
  if (cached && cached.until > Date.now()) return cached.url;
  const url = supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path, SIGNED_FOR).then(({ data, error }) => {
    if (error) throw error;
    return data.signedUrl;
  });
  url.catch(() => signed.delete(path));
  signed.set(path, { url, until: Date.now() + (SIGNED_FOR - 300) * 1000 });
  return url;
};

/**
 * Deletes images that are due (in a note deleted for good, or 30 days in the
 * Trash) from Storage now, instead of at the next hourly clean-up.
 */
export const purgeImages = () => supabase.functions.invoke('notes-images', { body: { action: 'purge' } }).catch(() => {});

/** Images in the Trash: [{path, note_id, trashed_at, delete_after}], newest first. */
export const listTrashedImages = async () => {
  const { data, error } = await supabase.from('note_images')
    .select('path, note_id, trashed_at, delete_after')
    .not('trashed_at', 'is', null)
    .order('trashed_at', { ascending: false });
  if (error) throw error;
  return data;
};

/** Marks images in the Trash to be deleted now (all of them without paths), then deletes them. */
export const deleteTrashedImages = async (paths) => {
  let query = supabase.from('note_images').update({ delete_after: new Date().toISOString() }).not('trashed_at', 'is', null);
  if (paths) query = query.in('path', paths);
  const { error } = await query;
  if (error) throw error;
  await purgeImages();
};

/** The Markdown that puts an image from the Trash back into a note. */
export const trashedImageMarkdown = (path) => imageMarkdown(import.meta.env.VITE_SUPABASE_URL, path);
