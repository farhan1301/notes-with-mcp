import { DEMO } from '../demo/mode';
import { memoryStorage } from '../demo/memoryStorage';

// The demo keeps everything in memory: it starts over on every reload.
const store = () => (DEMO ? memoryStorage : window.localStorage);

/** localStorage that never throws (private mode, quota, disabled storage). */
export const load = (key, fallback) => {
  try {
    const raw = store().getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const save = (key, value) => {
  try {
    store().setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
