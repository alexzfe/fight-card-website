import { loadData } from './data';

declare const __DATA_DIR__: string; // absolute; resolved from DATA_DIR in astro.config.mjs
declare const __BUILD_NOW__: string; // ISO; resolved from BUILD_NOW (or the clock) in astro.config.mjs

/** Loaded once per build; throws (failing the build) on contract violations. */
export const site = loadData(__DATA_DIR__);

/** The build's "now", which picks the current event (lib/events.ts). */
export const buildNow = new Date(__BUILD_NOW__);
