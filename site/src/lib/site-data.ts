import { loadData } from './data';

declare const __DATA_DIR__: string; // absolute; resolved from DATA_DIR in astro.config.mjs

/** Loaded once per build; throws (failing the build) on contract violations. */
export const site = loadData(__DATA_DIR__);
