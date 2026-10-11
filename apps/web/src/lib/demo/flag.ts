/**
 * Set at build time for the hosted demo site: the café runs entirely in the browser
 * on scripted demo data, with no server, sign-in or projects on disk.
 */
export const DEMO_SITE = process.env.NEXT_PUBLIC_DEMO_SITE === '1';

/** Where the demo site sends people who want the real thing. */
export const REPO_URL = 'https://github.com/JesusVelaz/agent-cafe';
