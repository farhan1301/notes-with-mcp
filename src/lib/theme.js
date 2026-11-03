import { load, save } from './storage';

const THEME_KEY = 'notes-with-mcp:theme';
export const THEMES = { system: 'System', light: 'Light', dark: 'Dark' };

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export const getTheme = () => {
  const theme = load(THEME_KEY, 'system');
  return theme in THEMES ? theme : 'system';
};

/** Put the `dark` class on <html> and match the browser chrome colour. */
export const applyTheme = (theme = getTheme()) => {
  const dark = theme === 'dark' || (theme === 'system' && Boolean(media()?.matches));
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute('content', dark ? '#0a0a0a' : '#fafaf9');
    m.removeAttribute('media');
  });
};

export const setTheme = (theme) => {
  save(THEME_KEY, theme);
  applyTheme(theme);
};

/** Follow the system setting while the theme is "System". */
export const watchSystemTheme = () => {
  const mq = media();
  const onChange = () => { if (getTheme() === 'system') applyTheme('system'); };
  mq?.addEventListener?.('change', onChange);
  return () => mq?.removeEventListener?.('change', onChange);
};
