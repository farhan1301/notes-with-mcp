/**
 * Demo mode (VITE_DEMO=true): the real app runs in the browser on sample data
 * from src/demo/seed.js. Nothing is saved; a reload starts over.
 */
export const DEMO = import.meta.env?.VITE_DEMO === 'true';

/** Shown for anything the demo cannot do without a backend. */
export const DEMO_UNAVAILABLE = 'This is the demo. Install your own copy to use this.';

/** Where the "Get your own" link in the demo banner points. */
export const REPO_URL = 'https://github.com/farhan1301/commonnotes';

/** Stands in for the Supabase project URL in image links written into notes. */
export const DEMO_PROJECT_URL = 'https://demo.commonnotes.invalid';
