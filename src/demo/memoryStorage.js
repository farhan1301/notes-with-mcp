/** Stands in for localStorage in demo mode, so nothing outlives the page. */
const items = new Map();

export const memoryStorage = {
  getItem: (key) => (items.has(key) ? items.get(key) : null),
  setItem: (key, value) => { items.set(key, String(value)); },
  removeItem: (key) => { items.delete(key); },
  clear: () => { items.clear(); },
};
